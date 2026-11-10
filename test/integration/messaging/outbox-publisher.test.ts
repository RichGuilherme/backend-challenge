import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SNSClient } from "@aws-sdk/client-sns";
import { PublishOutboxBatchUseCase } from "../../../src/application/messaging/publish-outbox-batch.use-case";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { SnsEventPublisher } from "../../../src/infrastructure/messaging/sns-event-publisher";
import { loadAwsConfig, loadOutboxConfig } from "../../../src/shared/config/env";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { EventSubscriberQueue } from "../../support/event-subscriber";
import { markAllPublished, outboxByPartition } from "../../support/outbox";

let context: TestContext;
let sns: SNSClient;
let subscriber: EventSubscriberQueue;
let submit: SubmitWagerTransactionUseCase;

const retryPolicy = { baseMs: 1_000, capMs: 300_000 };
const halfJitter = () => 0.5;

beforeAll(async () => {
  context = await createTestContext();
  const { region, endpoint } = loadAwsConfig();
  sns = new SNSClient({ region, ...(endpoint ? { endpoint } : {}) });
  subscriber = await EventSubscriberQueue.connect();
  submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
});

afterAll(async () => {
  subscriber?.close();
  sns?.destroy();
  await context?.close();
});

beforeEach(() => markAllPublished(context.sql));

const realPublisher = () => new SnsEventPublisher(sns, loadOutboxConfig().topicArn);
const brokenPublisher = () => new SnsEventPublisher(sns, "arn:aws:sns:us-east-1:000000000000:topico-inexistente.fifo");
const publishBatch = (publisher = realPublisher()) =>
  new PublishOutboxBatchUseCase(context.unitOfWork, publisher, context.clock, retryPolicy, halfJitter);

async function walletWithBet(): Promise<WalletView> {
  const wallet = await context.openWallet();
  await submit.execute(submitCommand(wallet.id, wallet.playerId));
  return wallet;
}

describe("publicador da outbox", () => {
  test("publica no tópico SNS, o evento chega à fila assinante e a mensagem é marcada como publicada", async () => {
    const wallet = await walletWithBet();
    const pending = await outboxByPartition(context.sql, wallet.id);

    const result = await publishBatch().execute(50);

    expect(result).toMatchObject({ claimed: 3, published: 3, retried: 0 });
    const received = await subscriber.collect(pending.map((row) => row.id));
    expect(received.map((event) => event.eventId).sort()).toEqual(pending.map((row) => row.id).sort());
    expect(received.every((event) => event.groupId === wallet.id)).toBe(true);
    const after = await outboxByPartition(context.sql, wallet.id);
    expect(after.every((row) => row.published_at !== null)).toBe(true);
    expect(received.find((event) => event.eventType === "WagerTransactionProcessed")?.body).toEqual(
      pending.find((row) => row.event_type === "WagerTransactionProcessed")?.payload as Record<string, unknown>,
    );
  });

  test("mensagem já publicada não é publicada de novo", async () => {
    await walletWithBet();
    await publishBatch().execute(50);
    expect(await publishBatch().execute(50)).toMatchObject({ claimed: 0, published: 0 });
  });

  test("falha real do SNS agenda nova tentativa com backoff e não perde a mensagem", async () => {
    const wallet = await walletWithBet();
    const before = Date.now();

    const result = await publishBatch(brokenPublisher()).execute(50);

    expect(result.published).toBe(0);
    expect(result.retried).toBeGreaterThanOrEqual(1);
    const rows = await outboxByPartition(context.sql, wallet.id);
    expect(rows.every((row) => row.published_at === null)).toBe(true);
    const retried = rows.filter((row) => row.attempts === 1);
    expect(retried).toHaveLength(1);
    expect(retried[0]!.next_attempt_at.getTime()).toBeGreaterThanOrEqual(before + 1_000 - 50);
    expect(await publishBatch().execute(50)).toMatchObject({ published: 2 });
  });

  test("falha numa wallet adia os eventos seguintes da mesma wallet, sem afetar outras wallets", async () => {
    const wallet = await walletWithBet();

    const result = await publishBatch(brokenPublisher()).execute(50);

    expect(result).toMatchObject({ claimed: 3, retried: 1, deferred: 2 });
    const rows = await outboxByPartition(context.sql, wallet.id);
    expect(rows.map((row) => row.attempts).sort()).toEqual([0, 0, 1]);
  });

  test("processo morre depois de publicar e antes de marcar: outra execução publica de novo e o FIFO deduplica", async () => {
    const wallet = await walletWithBet();
    const pending = await outboxByPartition(context.sql, wallet.id);
    const publisher = realPublisher();
    const crash = new Error("processo morreu antes do commit");

    const dying = context.unitOfWork.run(async ({ outbox }) => {
      for (const message of await outbox.claimDue(context.clock.now(), 50)) await publisher.publish(message);
      throw crash;
    });
    await expect(dying).rejects.toBe(crash);
    expect((await outboxByPartition(context.sql, wallet.id)).every((row) => row.published_at === null)).toBe(true);

    expect(await publishBatch().execute(50)).toMatchObject({ published: 3 });

    const received = await subscriber.collect(pending.map((row) => row.id));
    expect(received).toHaveLength(3);
    expect(new Set(received.map((event) => event.eventId)).size).toBe(3);
  });
});
