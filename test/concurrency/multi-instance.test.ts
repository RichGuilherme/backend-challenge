import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GetQueueAttributesCommand, SetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../src/application/wallet/wallet.view";
import { createTestContext, type TestContext } from "../support/application";
import { Cluster, type Role } from "../support/cluster";
import { testDatabaseConfig } from "../support/database";
import { EventSubscriberQueue } from "../support/event-subscriber";
import { expectAllWalletsMatchLedger } from "../support/ledger-invariant";
import { seededRandom, shuffled, type RandomSource } from "../support/random";
import { WagerQueueHarness, wagerEnvelope } from "../support/wager-queue";

const SEED = Number(process.env.TEST_SEED ?? 20261110);
const WALLETS = 100;
const BETS_PER_WALLET = 20;
const INITIAL_BALANCE = "1000.00";
const BET_AMOUNT = "1.00";
const EXPECTED_FINAL_BALANCE = "981.00";
const TRANSACTIONS_PER_WALLET = BETS_PER_WALLET + 1;
const TOTAL_TRANSACTIONS = WALLETS * TRANSACTIONS_PER_WALLET;
const HTTP_CONCURRENCY = 16;
const SQS_CONCURRENCY = 16;
const QUEUE_VISIBILITY_SECONDS = "5";
const DRAIN_TIMEOUT_MS = Number(process.env.TEST_DRAIN_TIMEOUT_MS ?? 150_000);

interface PlannedOperation {
  wallet: WalletView;
  externalTransactionId: string;
  kind: "BET" | "REFUND";
  referenceExternalTransactionId: string | undefined;
  via: "http" | "sqs";
  messageId: string;
  repeated: boolean;
}

interface KillPlan {
  role: Role;
  atProgress: number;
}

const KILL_PLAN: readonly KillPlan[] = [
  { role: "consumer", atProgress: 0.08 },
  { role: "api", atProgress: 0.15 },
  { role: "consumer", atProgress: 0.2 },
  { role: "outbox-publisher", atProgress: 0.25 },
  { role: "consumer", atProgress: 0.3 },
  { role: "consumer", atProgress: 0.4 },
  { role: "reference-worker", atProgress: 0.45 },
  { role: "consumer", atProgress: 0.5 },
  { role: "api", atProgress: 0.6 },
  { role: "outbox-publisher", atProgress: 0.7 },
];

let context: TestContext;
let harness: WagerQueueHarness;
let subscriber: EventSubscriberQueue;
let cluster: Cluster;
let originalVisibility: string | undefined;

beforeAll(async () => {
  context = await createTestContext({ lockTimeoutMs: 10_000 });
  harness = await WagerQueueHarness.connect();
  subscriber = await EventSubscriberQueue.connect();
  await harness.purge();
  await subscriber.purge();
  originalVisibility = (
    await harness.client.send(
      new GetQueueAttributesCommand({ QueueUrl: harness.urls.queueUrl, AttributeNames: ["VisibilityTimeout"] }),
    )
  ).Attributes?.VisibilityTimeout;
  await harness.client.send(
    new SetQueueAttributesCommand({
      QueueUrl: harness.urls.queueUrl,
      Attributes: { VisibilityTimeout: QUEUE_VISIBILITY_SECONDS },
    }),
  );
});

afterAll(async () => {
  await cluster?.terminateAll();
  if (originalVisibility) {
    await harness.client.send(
      new SetQueueAttributesCommand({
        QueueUrl: harness.urls.queueUrl,
        Attributes: { VisibilityTimeout: originalVisibility },
      }),
    );
  }
  subscriber?.close();
  harness?.close();
  await context?.close();
}, 60_000);

async function openWallets(): Promise<WalletView[]> {
  const open = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
  return Promise.all(
    Array.from({ length: WALLETS }, () =>
      open.execute({
        playerId: `player-${crypto.randomUUID()}`,
        initialBalance: { amount: INITIAL_BALANCE, currency: "BRL" },
        correlationId: "corr-multi-instance",
      }),
    ),
  );
}

function planOperations(wallets: readonly WalletView[], random: RandomSource): PlannedOperation[] {
  const operation = (
    wallet: WalletView,
    externalTransactionId: string,
    kind: "BET" | "REFUND",
    referenceExternalTransactionId?: string,
  ): PlannedOperation => ({
    wallet,
    externalTransactionId,
    kind,
    referenceExternalTransactionId,
    via: random() < 0.5 ? "http" : "sqs",
    messageId: `msg-${crypto.randomUUID()}`,
    repeated: random() < 0.1,
  });

  const units = wallets.flatMap((wallet) =>
    Array.from({ length: BETS_PER_WALLET }, (_unused, index) => {
      const betId = `bet-${wallet.id}-${index}`;
      const bet = operation(wallet, betId, "BET");
      return index === 0 ? [operation(wallet, `refund-${wallet.id}`, "REFUND", betId), bet] : [bet];
    }),
  );
  return shuffled(units, random).flat();
}

function payloadOf(op: PlannedOperation) {
  return {
    providerId: "provider-a",
    externalTransactionId: op.externalTransactionId,
    playerId: op.wallet.playerId,
    walletId: op.wallet.id,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: op.kind,
    money: { amount: BET_AMOUNT, currency: "BRL" },
    ...(op.referenceExternalTransactionId ? { referenceExternalTransactionId: op.referenceExternalTransactionId } : {}),
  };
}

async function runPool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let index = next++; index < items.length; index = next++) await work(items[index]!);
    }),
  );
}

class RoundRobinClient {
  private turn = 0;

  async submit(op: PlannedOperation): Promise<void> {
    const body = JSON.stringify(payloadOf(op));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const apis = cluster.liveApis();
      const api = apis[this.turn++ % Math.max(apis.length, 1)];
      if (api) {
        const status = await fetch(`${api.baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": `provider-a:${op.externalTransactionId}` },
          body,
          signal: AbortSignal.timeout(15_000),
        }).then(
          (response) => response.status,
          () => undefined,
        );
        if (status === 200 || status === 202 || status === 422) return;
      }
      await Bun.sleep(100 * (attempt + 1));
    }
    throw new Error(`HTTP sem resposta para ${op.externalTransactionId}`);
  }
}

async function sendToQueue(op: PlannedOperation): Promise<void> {
  const body = wagerEnvelope(op.messageId, {
    ...payloadOf(op),
    idempotencyKey: `provider-a:${op.externalTransactionId}`,
  });
  await harness.send(body, op.wallet.id);
}

async function processedTransactions(): Promise<number> {
  const [row] = await context.sql`select count(*)::int as count from wager_transactions where kind <> 'OPENING'`;
  return row.count;
}

async function consumersAreBusy(): Promise<boolean> {
  return (await harness.messagesInQueue()).inFlight > 0;
}

async function killWhenReached(plan: KillPlan, random: RandomSource): Promise<void> {
  while ((await processedTransactions()) / TOTAL_TRANSACTIONS < plan.atProgress) await Bun.sleep(25);
  if (plan.role === "consumer") {
    const patience = Date.now() + 10_000;
    while (!(await consumersAreBusy()) && Date.now() < patience) await Bun.sleep(10);
  }
  await cluster.killRandom(plan.role, random);
}

interface ProgressSnapshot {
  transactions: number;
  not_processed: number;
  pending_references: number;
  unpublished: number;
  queueVisible: number;
  queueInFlight: number;
}

async function snapshot(): Promise<ProgressSnapshot> {
  const [row] = await context.sql`
    select
      (select count(*)::int from wager_transactions where kind <> 'OPENING') as transactions,
      (select count(*)::int from wager_transactions where kind <> 'OPENING' and status <> 'PROCESSED') as not_processed,
      (select count(*)::int from pending_references) as pending_references,
      (select count(*)::int from outbox_messages where published_at is null) as unpublished`;
  const queue = await harness.messagesInQueue();
  return {
    transactions: row.transactions,
    not_processed: row.not_processed,
    pending_references: row.pending_references,
    unpublished: row.unpublished,
    queueVisible: queue.visible,
    queueInFlight: queue.inFlight,
  };
}

async function drain(): Promise<void> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  for (;;) {
    const state = await snapshot();
    const settled =
      state.transactions === TOTAL_TRANSACTIONS &&
      state.not_processed === 0 &&
      state.pending_references === 0 &&
      state.unpublished === 0 &&
      state.queueVisible === 0 &&
      state.queueInFlight === 0;
    if (settled) return;
    if (Date.now() > deadline) throw new Error(`não drenou em ${DRAIN_TIMEOUT_MS}ms: ${JSON.stringify(state)} (seed ${SEED})`);
    await Bun.sleep(500);
  }
}

describe("múltiplas instâncias reais sob carga, com processos mortos no meio", () => {
  test(
    "3 APIs, 3 consumidores, 3 publicadores e 1 worker de referências: nada duplica, nada se perde",
    async () => {
      const random = seededRandom(SEED);
      const wallets = await openWallets();
      const operations = planOperations(wallets, random);

      cluster = new Cluster({
        DB_NAME: testDatabaseConfig().name,
        LOG_LEVEL: "error",
        DB_LOCK_TIMEOUT_MS: "10000",
        OUTBOX_POLL_INTERVAL_MS: "100",
        PENDING_REFERENCE_POLL_INTERVAL_MS: "200",
        PENDING_REFERENCE_RETRY_BASE_MS: "200",
        PENDING_REFERENCE_RETRY_CAP_MS: "2000",
      });
      await Promise.all([
        cluster.start("api", 3),
        cluster.start("consumer", 3),
        cluster.start("outbox-publisher", 3),
        cluster.start("reference-worker", 1),
      ]);

      const client = new RoundRobinClient();
      const httpOperations = operations.filter((op) => op.via === "http");
      const sqsOperations = operations.filter((op) => op.via === "sqs");
      const killers = KILL_PLAN.map((plan) => killWhenReached(plan, random));

      await Promise.all([
        runPool(httpOperations, HTTP_CONCURRENCY, async (op) => {
          await client.submit(op);
          if (op.repeated) await client.submit(op);
        }),
        runPool(sqsOperations, SQS_CONCURRENCY, async (op) => {
          await sendToQueue(op);
          if (op.repeated) await sendToQueue(op);
        }),
      ]);
      await Promise.all(killers);
      await drain();

      expect(cluster.kills.map((kill) => kill.role).sort()).toEqual(KILL_PLAN.map((plan) => plan.role).sort());
      await expectAllWalletsMatchLedger(context.sql);

      const perWallet = await context.sql`
        select w.balance, w.version,
          (select count(*)::int from wager_transactions t where t.wallet_id = w.id and t.kind <> 'OPENING') as transactions,
          (select count(*)::int from wallet_ledger_entries e where e.wallet_id = w.id) as entries
        from wallets w`;
      expect(perWallet).toHaveLength(WALLETS);
      for (const wallet of perWallet) {
        expect(wallet).toEqual({
          balance: EXPECTED_FINAL_BALANCE,
          version: TRANSACTIONS_PER_WALLET + 1,
          transactions: TRANSACTIONS_PER_WALLET,
          entries: TRANSACTIONS_PER_WALLET + 1,
        });
      }

      const [uniqueness] = await context.sql`
        select
          (select count(*)::int from (select idempotency_key from wager_transactions group by 1 having count(*) > 1) d) as duplicate_keys,
          (select count(*)::int from (select consumer_name, message_id from inbox_messages group by 1, 2 having count(*) > 1) d) as duplicate_inbox,
          (select count(*)::int from inbox_messages where processed_at is null) as unprocessed_inbox`;
      expect(uniqueness).toEqual({ duplicate_keys: 0, duplicate_inbox: 0, unprocessed_inbox: 0 });

      const [inbox] = await context.sql`select count(distinct message_id)::int as messages from inbox_messages`;
      expect(inbox.messages).toBe(new Set(sqsOperations.map((op) => op.messageId)).size);

      expect(await harness.takeDeadLetters(1_500)).toEqual([]);

      const published: { id: string }[] = await context.sql`select id from outbox_messages`;
      const received = await subscriber.collect(
        published.map((row) => row.id),
        90_000,
      );
      expect(new Set(received.map((event) => event.eventId))).toEqual(new Set(published.map((row) => row.id)));

      const terminated = await cluster.terminateAll();
      for (const service of terminated) expect([0, 128 + 15]).toContain(service.exitCode);
    },
    420_000,
  );
});
