import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SNSClient } from "@aws-sdk/client-sns";
import type { OutboxMessage } from "../../src/application/messaging/outbox-message";
import { PublishOutboxBatchUseCase } from "../../src/application/messaging/publish-outbox-batch.use-case";
import type { EventPublisher } from "../../src/application/ports/event-publisher";
import { SubmitWagerTransactionUseCase } from "../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import { SnsEventPublisher } from "../../src/infrastructure/messaging/sns-event-publisher";
import { loadAwsConfig, loadOutboxConfig } from "../../src/shared/config/env";
import { createTestContext, type TestContext } from "../support/application";
import { submitCommand } from "../support/commands";
import { EventSubscriberQueue } from "../support/event-subscriber";

let context: TestContext;
let sns: SNSClient;
let subscriber: EventSubscriberQueue;

beforeAll(async () => {
  context = await createTestContext();
  const { region, endpoint } = loadAwsConfig();
  sns = new SNSClient({ region, ...(endpoint ? { endpoint } : {}) });
  subscriber = await EventSubscriberQueue.connect();
});

afterAll(async () => {
  subscriber?.close();
  sns?.destroy();
  await context?.close();
});

class CountingPublisher implements EventPublisher {
  readonly publications = new Map<string, number>();

  constructor(private readonly inner: EventPublisher) {}

  async publish(message: OutboxMessage): Promise<void> {
    this.publications.set(message.id, (this.publications.get(message.id) ?? 0) + 1);
    await this.inner.publish(message);
  }
}

async function drain(useCase: PublishOutboxBatchUseCase, batchSize: number): Promise<void> {
  while ((await useCase.execute(batchSize)).claimed > 0) {
    await Bun.sleep(0);
  }
}

describe("publicadores concorrentes sobre a mesma outbox", () => {
  test("três publicadores em paralelo: toda mensagem é publicada exatamente uma vez e nada se perde", async () => {
    const openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
    const submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        const wallet = await openWallet.execute({
          playerId: `player-${crypto.randomUUID()}`,
          initialBalance: { amount: "100.00", currency: "BRL" },
          correlationId: "corr-concurrency",
        });
        await submit.execute(submitCommand(wallet.id, wallet.playerId));
      }),
    );
    const enqueued: { id: string }[] = await context.sql`select id from outbox_messages where published_at is null`;
    expect(enqueued).toHaveLength(60);

    const counter = new CountingPublisher(new SnsEventPublisher(sns, loadOutboxConfig().topicArn));
    const publisherFor = () =>
      new PublishOutboxBatchUseCase(context.unitOfWork, counter, context.clock, { baseMs: 1_000, capMs: 300_000 });

    await Promise.all([drain(publisherFor(), 5), drain(publisherFor(), 5), drain(publisherFor(), 5)]);

    expect(counter.publications.size).toBe(60);
    expect([...counter.publications.values()].every((count) => count === 1)).toBe(true);
    const [{ pending }] = await context.sql`select count(*)::int as pending from outbox_messages where published_at is null`;
    expect(pending).toBe(0);
    const received = await subscriber.collect(enqueued.map((row) => row.id), 20_000);
    expect(new Set(received.map((event) => event.eventId)).size).toBe(60);
  }, 60_000);
});
