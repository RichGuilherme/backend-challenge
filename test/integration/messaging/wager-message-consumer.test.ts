import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ConsumeWagerMessageUseCase,
  type WagerMessage,
} from "../../../src/application/messaging/consume-wager-message.use-case";
import { Registry } from "prom-client";
import { NO_LOGGER } from "../../../src/application/ports/logger";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { PrometheusMetrics } from "../../../src/infrastructure/observability/prometheus-metrics";
import { PostgresUnitOfWork } from "../../../src/infrastructure/persistence/postgres-unit-of-work";
import { SqsWagerMessageQueue } from "../../../src/infrastructure/messaging/sqs-wager-message-queue";
import { WAGER_CONSUMER_NAME, WagerMessageConsumer } from "../../../src/presentation/messaging/wager-message.consumer";
import { createTestContext, type TestContext } from "../../support/application";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";
import { sampleOf } from "../../support/metrics";
import { outboxFor } from "../../support/outbox";
import { WagerQueueHarness, wagerEnvelope } from "../../support/wager-queue";

let context: TestContext;
let harness: WagerQueueHarness;
let openWallet: OpenWalletUseCase;

const registry = new Registry();
const metrics = new PrometheusMetrics(registry);
const observability = { metrics, logger: NO_LOGGER };
const MAX_RECEIVES = 5;

const metricValue = async (name: string, labels: Record<string, string> = {}) =>
  (await sampleOf(registry, name, labels)) ?? 0;
const deadLettered = (reason: string) => metricValue("wagering_dlq_messages_total", { reason });
const immediateRetry = { baseMs: 1, capMs: 1 };

beforeAll(async () => {
  context = await createTestContext();
  harness = await WagerQueueHarness.connect();
  await harness.purge();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
});

afterAll(async () => {
  harness?.close();
  await context?.close();
});

function consumerWith(unitOfWork = context.unitOfWork, onConsumed?: () => void) {
  const submit = new SubmitWagerTransactionUseCase(unitOfWork, context.ids, context.clock);
  const consume = new ConsumeWagerMessageUseCase(unitOfWork, submit, context.clock, metrics);
  const observed = onConsumed
    ? ({
        execute: async (message: WagerMessage) => {
          const outcome = await consume.execute(message);
          onConsumed();
          return outcome;
        },
      } as ConsumeWagerMessageUseCase)
    : consume;
  return new WagerMessageConsumer(
    new SqsWagerMessageQueue(harness.client, harness.urls),
    observed,
    { batchSize: 10, waitSeconds: 1, retry: immediateRetry, maxReceives: MAX_RECEIVES },
    observability,
    () => 0,
  );
}

const open = (amount = "100.00"): Promise<WalletView> =>
  openWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: { amount, currency: "BRL" },
    correlationId: "corr-consumer",
  });

function wagerData(wallet: WalletView, overrides: Record<string, unknown> = {}) {
  const externalTransactionId = `transaction-${crypto.randomUUID()}`;
  return {
    providerId: "provider-a",
    externalTransactionId,
    idempotencyKey: `provider-a:${externalTransactionId}`,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: "BET",
    money: { amount: "25.00", currency: "BRL" },
    ...overrides,
  };
}

async function transactionsOf(walletId: string) {
  return context.sql`
    select id, kind, status, failure_code from wager_transactions where wallet_id = ${walletId} and kind <> 'OPENING'`;
}

async function inboxCount(messageId: string): Promise<number> {
  const [row] = await context.sql`
    select count(*)::int as count from inbox_messages
    where consumer_name = ${WAGER_CONSUMER_NAME} and message_id = ${messageId} and processed_at is not null`;
  return row.count;
}

async function pollUntilEmpty(consumer: WagerMessageConsumer): Promise<void> {
  while (await consumer.pollOnce()) {
    await Bun.sleep(0);
  }
}

describe("consumidor SQS de transações", () => {
  test("processa a mensagem com o mesmo caso de uso do HTTP, grava a inbox e dá ack só depois do commit", async () => {
    const wallet = await open();
    const messageId = `msg-${crypto.randomUUID()}`;
    const durationsBefore = await metricValue("wagering_processing_duration_seconds_count", { source: "sqs" });
    await harness.send(wagerEnvelope(messageId, wagerData(wallet)), wallet.id, "corr-from-queue");

    await pollUntilEmpty(consumerWith());

    expect(await metricValue("wagering_processing_duration_seconds_count", { source: "sqs" })).toBe(
      durationsBefore + 1,
    );

    const [transaction] = await transactionsOf(wallet.id);
    expect(transaction).toMatchObject({ kind: "BET", status: "PROCESSED" });
    expect(await inboxCount(messageId)).toBe(1);
    expect(await harness.messagesInQueue()).toEqual({ visible: 0, inFlight: 0 });
    const events = await outboxFor(context.sql, [transaction.id]);
    expect(events.every((row) => row.payload.causationId === messageId)).toBe(true);
    expect(events.every((row) => row.payload.correlationId === "corr-from-queue")).toBe(true);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("redelivery da mesma mensagem não duplica o efeito", async () => {
    const wallet = await open();
    const messageId = `msg-${crypto.randomUUID()}`;
    const body = wagerEnvelope(messageId, wagerData(wallet));
    await harness.send(body, wallet.id);
    await harness.send(body, wallet.id);
    await harness.send(body, wallet.id);

    await pollUntilEmpty(consumerWith());

    expect(await transactionsOf(wallet.id)).toHaveLength(1);
    expect(await inboxCount(messageId)).toBe(1);
    expect(await harness.messagesInQueue()).toEqual({ visible: 0, inFlight: 0 });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("mensagens diferentes com a mesma Idempotency-Key viram replay: uma transação, duas entradas na inbox", async () => {
    const wallet = await open();
    const data = wagerData(wallet);
    const first = `msg-${crypto.randomUUID()}`;
    const second = `msg-${crypto.randomUUID()}`;
    await harness.send(wagerEnvelope(first, data), wallet.id);
    await harness.send(wagerEnvelope(second, data), wallet.id);

    await pollUntilEmpty(consumerWith());

    expect(await transactionsOf(wallet.id)).toHaveLength(1);
    expect([await inboxCount(first), await inboxCount(second)]).toEqual([1, 1]);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("processo morre depois do commit e antes do ack: a reentrega não duplica", async () => {
    const wallet = await open();
    const messageId = `msg-${crypto.randomUUID()}`;
    const data = wagerData(wallet);
    const submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
    await new ConsumeWagerMessageUseCase(context.unitOfWork, submit, context.clock).execute({
      consumerName: WAGER_CONSUMER_NAME,
      messageId,
      command: { ...data, kind: WagerTransactionKind.Bet, correlationId: messageId, causationId: messageId },
    });
    await harness.send(wagerEnvelope(messageId, data), wallet.id);

    await pollUntilEmpty(consumerWith());

    expect(await transactionsOf(wallet.id)).toHaveLength(1);
    expect(await harness.messagesInQueue()).toEqual({ visible: 0, inFlight: 0 });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("rejeição de negócio é registrada e recebe ack, sem ir para a DLQ", async () => {
    const wallet = await open("1.00");
    await harness.send(wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(wallet)), wallet.id);

    await pollUntilEmpty(consumerWith());

    expect(await transactionsOf(wallet.id)).toEqual([
      expect.objectContaining({ status: "REJECTED", failure_code: "INSUFFICIENT_FUNDS" }),
    ]);
    expect(await harness.takeDeadLetters(1_500)).toHaveLength(0);
  });

  describe("mensagem permanente vai direto para a DLQ com o motivo", () => {
    test("JSON inválido", async () => {
      const before = await deadLettered("INVALID_JSON");
      await harness.send("{ isto não é json", "grupo-invalido");
      await pollUntilEmpty(consumerWith());
      expect(await harness.takeDeadLetters()).toEqual([{ body: "{ isto não é json", failureReason: "INVALID_JSON" }]);
      expect(await deadLettered("INVALID_JSON")).toBe(before + 1);
      expect(await harness.messagesInQueue()).toEqual({ visible: 0, inFlight: 0 });
    });

    test("schema inválido (OPENING pela fila)", async () => {
      const before = await deadLettered("INVALID_PAYLOAD");
      const wallet = await open();
      await harness.send(
        wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(wallet, { kind: "OPENING" })),
        wallet.id,
      );
      await pollUntilEmpty(consumerWith());
      const [letter] = await harness.takeDeadLetters();
      expect(letter?.failureReason).toStartWith("INVALID_PAYLOAD");
      expect(await deadLettered("INVALID_PAYLOAD")).toBe(before + 1);
      expect(await transactionsOf(wallet.id)).toHaveLength(0);
    });

    test.each(["BET", "LOSS"])("%s com referência é payload inválido", async (kind) => {
      const before = await deadLettered("INVALID_PAYLOAD");
      const wallet = await open();
      await harness.send(
        wagerEnvelope(
          `msg-${crypto.randomUUID()}`,
          wagerData(wallet, { kind, referenceExternalTransactionId: "outra" }),
        ),
        wallet.id,
      );
      await pollUntilEmpty(consumerWith());
      const [letter] = await harness.takeDeadLetters();
      expect(letter?.failureReason).toStartWith("INVALID_PAYLOAD");
      expect(await deadLettered("INVALID_PAYLOAD")).toBe(before + 1);
      expect(await transactionsOf(wallet.id)).toHaveLength(0);
    });

    test("wallet inexistente", async () => {
      const before = await deadLettered("WALLET_NOT_FOUND");
      const ghost = { id: crypto.randomUUID(), playerId: "player-fantasma" } as WalletView;
      await harness.send(wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(ghost)), ghost.id);
      await pollUntilEmpty(consumerWith());
      const [letter] = await harness.takeDeadLetters();
      expect(letter?.failureReason).toContain("não encontrada");
      expect(await deadLettered("WALLET_NOT_FOUND")).toBe(before + 1);
    });

    test("conflito de idempotência", async () => {
      const before = await deadLettered("IDEMPOTENCY_CONFLICT");
      const wallet = await open();
      const data = wagerData(wallet);
      await harness.send(wagerEnvelope(`msg-${crypto.randomUUID()}`, data), wallet.id);
      await harness.send(
        wagerEnvelope(`msg-${crypto.randomUUID()}`, { ...data, money: { amount: "30.00", currency: "BRL" } }),
        wallet.id,
      );
      await pollUntilEmpty(consumerWith());
      const [letter] = await harness.takeDeadLetters();
      expect(letter?.failureReason).toContain("outro payload");
      expect(await deadLettered("IDEMPOTENCY_CONFLICT")).toBe(before + 1);
      expect(await transactionsOf(wallet.id)).toHaveLength(1);
    });
  });

  describe("erro transitório", () => {
    async function holdWalletLock(walletId: string) {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve));
      let signal!: () => void;
      const locked = new Promise<void>((resolve) => (signal = resolve));
      const holder = context.unitOfWork.run(async ({ wallets }) => {
        await wallets.lockById(walletId);
        signal();
        await hold;
      });
      await locked;
      return async () => {
        release();
        await holder;
      };
    }

    test("volta para a fila sem ack e é processado quando a falha passa", async () => {
      const wallet = await open();
      const impatient = consumerWith(new PostgresUnitOfWork(context.orm, 100));
      const releaseLock = await holdWalletLock(wallet.id);
      const retriesBefore = await metricValue("wagering_message_retries_total");
      await harness.send(wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(wallet)), wallet.id);

      await impatient.pollOnce();
      expect(await metricValue("wagering_message_retries_total")).toBe(retriesBefore + 1);
      expect(await transactionsOf(wallet.id)).toHaveLength(0);
      expect(await harness.takeDeadLetters(1_500)).toHaveLength(0);

      await releaseLock();
      await pollUntilEmpty(impatient);
      expect(await transactionsOf(wallet.id)).toEqual([expect.objectContaining({ status: "PROCESSED" })]);
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("esgotadas as 5 tentativas, o redrive da fila manda para a DLQ", async () => {
      const wallet = await open();
      const impatient = consumerWith(new PostgresUnitOfWork(context.orm, 100));
      const releaseLock = await holdWalletLock(wallet.id);
      const body = wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(wallet));
      const retriesBefore = await metricValue("wagering_message_retries_total");
      const exhaustedBefore = await deadLettered("RETRIES_EXHAUSTED");
      await harness.send(body, wallet.id);

      for (let attempt = 0; attempt < 7; attempt += 1) await impatient.pollOnce();
      await releaseLock();

      expect(await metricValue("wagering_message_retries_total")).toBe(retriesBefore + MAX_RECEIVES - 1);
      expect(await deadLettered("RETRIES_EXHAUSTED")).toBe(exhaustedBefore + 1);

      const letters = await harness.takeDeadLetters();
      expect(letters.map((letter) => letter.body)).toEqual([body]);
      expect(await transactionsOf(wallet.id)).toHaveLength(0);
    }, 30_000);
  });

  describe("parada graciosa", () => {
    test("após requestStop termina a mensagem em andamento e devolve as demais na hora", async () => {
      const wallet = await open();
      const bodies = [1, 2, 3].map(() => wagerEnvelope(`msg-${crypto.randomUUID()}`, wagerData(wallet)));
      for (const body of bodies) await harness.send(body, wallet.id);

      let consumer!: WagerMessageConsumer;
      consumer = consumerWith(context.unitOfWork, () => consumer.requestStop());
      await consumer.pollOnce();

      expect(await transactionsOf(wallet.id)).toHaveLength(1);
      expect(await consumer.pollOnce()).toBe(false);
      await Bun.sleep(200);
      expect((await harness.messagesInQueue()).visible).toBe(2);

      await pollUntilEmpty(consumerWith());
      expect(await transactionsOf(wallet.id)).toHaveLength(3);
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });
  });
});
