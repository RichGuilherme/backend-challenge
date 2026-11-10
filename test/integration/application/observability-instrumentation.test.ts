import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import type { LogFields, Logger } from "../../../src/application/ports/logger";
import { TransientFailureError } from "../../../src/application/shared/application-error";
import { DEFAULT_PENDING_REFERENCE_POLICY } from "../../../src/application/wagering/pending-reference";
import { ResolvePendingReferenceUseCase } from "../../../src/application/wagering/resolve-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { PrometheusMetrics } from "../../../src/infrastructure/observability/prometheus-metrics";
import { PostgresUnitOfWork } from "../../../src/infrastructure/persistence/postgres-unit-of-work";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { sampleOf } from "../../support/metrics";
import { TestClock } from "../../support/test-clock";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  fields: LogFields;
}

let context: TestContext;
let registry: Registry;
let metrics: PrometheusMetrics;
let logs: LogEntry[];
let clock: TestClock;
let openWallet: OpenWalletUseCase;
let submit: SubmitWagerTransactionUseCase;
let resolve: ResolvePendingReferenceUseCase;

const half = () => 0.5;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

beforeEach(async () => {
  registry = new Registry();
  logs = [];
  clock = new TestClock();
  const logger: Logger = {
    info: (message, fields = {}) => logs.push({ level: "info", message, fields }),
    warn: (message, fields = {}) => logs.push({ level: "warn", message, fields }),
    error: (message, fields = {}) => logs.push({ level: "error", message, fields }),
  };
  metrics = new PrometheusMetrics(registry);
  const observability = { metrics, logger };
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, clock);
  submit = new SubmitWagerTransactionUseCase(
    context.unitOfWork,
    context.ids,
    clock,
    DEFAULT_PENDING_REFERENCE_POLICY,
    half,
    observability,
  );
  resolve = new ResolvePendingReferenceUseCase(
    context.unitOfWork,
    context.ids,
    clock,
    DEFAULT_PENDING_REFERENCE_POLICY,
    half,
    observability,
  );
  await context.sql`delete from pending_references`;
});

const open = (amount = "100.00"): Promise<WalletView> =>
  openWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: { amount, currency: "BRL" },
    correlationId: "corr-open",
  });

const transactions = (kind: string, status: string) =>
  sampleOf(registry, "wagering_transactions_total", { kind, status });

describe("instrumentação da submissão", () => {
  test("conta a transação por kind e status e loga os campos de correlação, sem o valor", async () => {
    const wallet = await open("1000.00");
    const bet = submitCommand(wallet.id, wallet.playerId, {
      correlationId: "corr-bet",
      causationId: "msg-77",
      money: { amount: "123.45", currency: "BRL" },
    });

    const result = await submit.execute(bet);

    expect(await transactions("BET", "PROCESSED")).toBe(1);
    expect(await sampleOf(registry, "wagering_idempotent_replays_total")).toBe(0);
    expect(logs).toEqual([
      {
        level: "info",
        message: "transação submetida",
        fields: {
          correlationId: "corr-bet",
          messageId: "msg-77",
          transactionId: result.transactionId,
          walletId: wallet.id,
          providerId: "provider-a",
          kind: "BET",
          status: "PROCESSED",
          failureCode: undefined,
          idempotentReplay: false,
        },
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("123.45");
  });

  test("rejeição conta com o status REJECTED e loga o failureCode", async () => {
    const wallet = await open("1.00");

    await submit.execute(submitCommand(wallet.id, wallet.playerId));

    expect(await transactions("BET", "REJECTED")).toBe(1);
    expect(logs[0]?.fields).toMatchObject({ status: "REJECTED", failureCode: "INSUFFICIENT_FUNDS" });
  });

  test("referência ausente conta como PENDING_REFERENCE", async () => {
    const wallet = await open();

    await submit.execute(
      submitCommand(wallet.id, wallet.playerId, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ainda-nao-chegou",
      }),
    );

    expect(await transactions("REFUND", "PENDING_REFERENCE")).toBe(1);
  });

  test("replay conta como duplicata e não como nova transação", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    await submit.execute(bet);

    await submit.execute(bet);
    await submit.execute(bet);

    expect(await transactions("BET", "PROCESSED")).toBe(1);
    expect(await sampleOf(registry, "wagering_idempotent_replays_total")).toBe(2);
    expect(logs.map((entry) => entry.fields.idempotentReplay)).toEqual([false, true, true]);
  });

  test("conflito de idempotência não conta transação nem duplicata", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    await submit.execute(bet);

    await expect(submit.execute({ ...bet, money: { amount: "1.00", currency: "BRL" } })).rejects.toThrow();

    expect(await transactions("BET", "PROCESSED")).toBe(1);
    expect(await sampleOf(registry, "wagering_idempotent_replays_total")).toBe(0);
  });
});

describe("instrumentação do worker de referências", () => {
  test("reversão resolvida conta a transação, mede a duração e loga o desfecho", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    const refund = submitCommand(wallet.id, wallet.playerId, {
      kind: WagerTransactionKind.Refund,
      money: bet.money,
      referenceExternalTransactionId: bet.externalTransactionId,
    });
    const pending = await submit.execute(refund);
    await submit.execute(bet);
    clock.advance(2_000);
    logs.length = 0;

    await resolve.execute();

    expect(await transactions("REFUND", "PROCESSED")).toBe(1);
    expect(await sampleOf(registry, "wagering_processing_duration_seconds_count", { source: "reference-worker" })).toBe(
      1,
    );
    expect(logs).toEqual([
      {
        level: "info",
        message: "referência pendente resolvida",
        fields: expect.objectContaining({
          transactionId: pending.transactionId,
          walletId: wallet.id,
          providerId: "provider-a",
          outcome: "PROCESSED",
        }),
      },
    ]);
  });

  test("reagendamento mede a duração mas não conta transação", async () => {
    const wallet = await open();
    await submit.execute(
      submitCommand(wallet.id, wallet.playerId, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "nunca-chega",
      }),
    );
    clock.advance(2_000);

    expect(await resolve.execute()).toBe("RESCHEDULED");

    expect(await transactions("REFUND", "REJECTED")).toBeUndefined();
    expect(await sampleOf(registry, "wagering_processing_duration_seconds_count", { source: "reference-worker" })).toBe(
      1,
    );
  });

  test("sem pendência vencida não mede nada", async () => {
    await resolve.execute();
    expect(
      await sampleOf(registry, "wagering_processing_duration_seconds_count", { source: "reference-worker" }),
    ).toBeUndefined();
  });
});

describe("instrumentação do lock", () => {
  test("lock timeout conta um conflito de lock e continua sendo falha transitória", async () => {
    const wallet = await open();
    const impatient = new PostgresUnitOfWork(context.orm, 100, metrics);
    let release!: () => void;
    const hold = new Promise<void>((done) => (release = done));
    let signal!: () => void;
    const locked = new Promise<void>((done) => (signal = done));
    const holder = context.unitOfWork.run(async ({ wallets }) => {
      await wallets.lockById(wallet.id);
      signal();
      await hold;
    });
    await locked;

    await expect(impatient.run(({ wallets }) => wallets.lockById(wallet.id))).rejects.toBeInstanceOf(
      TransientFailureError,
    );

    release();
    await holder;
    expect(await sampleOf(registry, "wagering_lock_conflicts_total")).toBe(1);
  });

  test("erro que não é de lock não conta conflito", async () => {
    const counting = new PostgresUnitOfWork(context.orm, 100, metrics);
    await expect(
      counting.run(async () => {
        throw new Error("bug");
      }),
    ).rejects.toThrow("bug");
    expect(await sampleOf(registry, "wagering_lock_conflicts_total")).toBe(0);
  });
});
