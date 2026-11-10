import { expect } from "bun:test";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../src/application/wallet/wallet.view";
import type { TestContext } from "./application";
import type { Cluster } from "./cluster";
import type { EventSubscriberQueue } from "./event-subscriber";
import { expectAllWalletsMatchLedger } from "./ledger-invariant";
import { brl } from "./money";
import { shuffled, type RandomSource } from "./random";
import { WagerQueueHarness, wagerEnvelope } from "./wager-queue";

const INITIAL_BALANCE = "1000.00";
const BET_AMOUNT = "1.00";
const HTTP_CONCURRENCY = 16;
const SQS_CONCURRENCY = 16;
const HTTP_ATTEMPTS = 40;

export interface PlannedOperation {
  wallet: WalletView;
  externalTransactionId: string;
  kind: "BET" | "REFUND";
  referenceExternalTransactionId: string | undefined;
  via: "http" | "sqs";
  messageId: string;
  repeated: boolean;
}

export interface ScenarioDependencies {
  context: TestContext;
  harness: WagerQueueHarness;
  subscriber: EventSubscriberQueue;
  cluster: () => Cluster;
}

export interface ScenarioOptions {
  wallets: number;
  betsPerWallet: number;
  random: RandomSource;
  seed: number;
}

interface ProgressSnapshot {
  transactions: number;
  not_processed: number;
  pending_references: number;
  unpublished: number;
  queueVisible: number;
  queueInFlight: number;
}

export class LoadScenario {
  readonly transactionsPerWallet: number;
  readonly totalTransactions: number;
  readonly expectedFinalBalance: string;
  private turn = 0;

  constructor(
    private readonly deps: ScenarioDependencies,
    private readonly options: ScenarioOptions,
  ) {
    this.transactionsPerWallet = options.betsPerWallet + 1;
    this.totalTransactions = options.wallets * this.transactionsPerWallet;
    this.expectedFinalBalance = Array.from({ length: options.betsPerWallet })
      .reduce((balance: ReturnType<typeof brl>) => balance.subtract(brl(BET_AMOUNT)), brl(INITIAL_BALANCE))
      .add(brl(BET_AMOUNT))
      .toJSON().amount;
  }

  async openWallets(): Promise<WalletView[]> {
    const { context } = this.deps;
    const open = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
    return Promise.all(
      Array.from({ length: this.options.wallets }, () =>
        open.execute({
          playerId: `player-${crypto.randomUUID()}`,
          initialBalance: { amount: INITIAL_BALANCE, currency: "BRL" },
          correlationId: "corr-load-scenario",
        }),
      ),
    );
  }

  plan(wallets: readonly WalletView[]): PlannedOperation[] {
    const { random, betsPerWallet } = this.options;
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
      Array.from({ length: betsPerWallet }, (_unused, index) => {
        const betId = `bet-${wallet.id}-${index}`;
        const bet = operation(wallet, betId, "BET");
        return index === 0 ? [operation(wallet, `refund-${wallet.id}`, "REFUND", betId), bet] : [bet];
      }),
    );
    return shuffled(units, random).flat();
  }

  async run(operations: readonly PlannedOperation[]): Promise<void> {
    await Promise.all([
      runPool(
        operations.filter((op) => op.via === "http"),
        HTTP_CONCURRENCY,
        async (op) => {
          await this.submitOverHttp(op);
          if (op.repeated) await this.submitOverHttp(op);
        },
      ),
      runPool(
        operations.filter((op) => op.via === "sqs"),
        SQS_CONCURRENCY,
        async (op) => {
          await this.sendToQueue(op);
          if (op.repeated) await this.sendToQueue(op);
        },
      ),
    ]);
  }

  async progress(): Promise<number> {
    const [row] = await this.deps.context
      .sql`select count(*)::int as count from wager_transactions where kind <> 'OPENING'`;
    return row.count / this.totalTransactions;
  }

  async drain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.snapshot();
      const settled =
        state.transactions === this.totalTransactions &&
        state.not_processed === 0 &&
        state.pending_references === 0 &&
        state.unpublished === 0 &&
        state.queueVisible === 0 &&
        state.queueInFlight === 0;
      if (settled) return;
      if (Date.now() > deadline) {
        throw new Error(`não drenou em ${timeoutMs}ms: ${JSON.stringify(state)} (seed ${this.options.seed})`);
      }
      await Bun.sleep(500);
    }
  }

  async verifyFinalState(operations: readonly PlannedOperation[]): Promise<void> {
    const { context, harness, subscriber } = this.deps;
    await expectAllWalletsMatchLedger(context.sql);

    const perWallet = await context.sql`
      select w.balance, w.version,
        (select count(*)::int from wager_transactions t where t.wallet_id = w.id and t.kind <> 'OPENING') as transactions,
        (select count(*)::int from wallet_ledger_entries e where e.wallet_id = w.id) as entries
      from wallets w`;
    expect(perWallet).toHaveLength(this.options.wallets);
    for (const wallet of perWallet) {
      expect(wallet).toEqual({
        balance: this.expectedFinalBalance,
        version: this.transactionsPerWallet + 1,
        transactions: this.transactionsPerWallet,
        entries: this.transactionsPerWallet + 1,
      });
    }

    const [uniqueness] = await context.sql`
      select
        (select count(*)::int from (select idempotency_key from wager_transactions group by 1 having count(*) > 1) d) as duplicate_keys,
        (select count(*)::int from (select consumer_name, message_id from inbox_messages group by 1, 2 having count(*) > 1) d) as duplicate_inbox,
        (select count(*)::int from inbox_messages where processed_at is null) as unprocessed_inbox`;
    expect(uniqueness).toEqual({ duplicate_keys: 0, duplicate_inbox: 0, unprocessed_inbox: 0 });

    const [inbox] = await context.sql`select count(distinct message_id)::int as messages from inbox_messages`;
    expect(inbox.messages).toBe(new Set(operations.filter((op) => op.via === "sqs").map((op) => op.messageId)).size);

    expect(await harness.takeDeadLetters(1_500)).toEqual([]);

    const published: { id: string }[] = await context.sql`select id from outbox_messages`;
    const received = await subscriber.collect(
      published.map((row) => row.id),
      90_000,
    );
    expect(new Set(received.map((event) => event.eventId))).toEqual(new Set(published.map((row) => row.id)));
  }

  private async submitOverHttp(op: PlannedOperation): Promise<void> {
    const body = JSON.stringify(payloadOf(op));
    for (let attempt = 0; attempt < HTTP_ATTEMPTS; attempt += 1) {
      const apis = this.deps.cluster().liveApis();
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
      await Bun.sleep(Math.min(100 * (attempt + 1), 1_000));
    }
    throw new Error(`HTTP sem resposta para ${op.externalTransactionId}`);
  }

  private async sendToQueue(op: PlannedOperation): Promise<void> {
    const body = wagerEnvelope(op.messageId, {
      ...payloadOf(op),
      idempotencyKey: `provider-a:${op.externalTransactionId}`,
    });
    await this.deps.harness.send(body, op.wallet.id);
  }

  private async snapshot(): Promise<ProgressSnapshot> {
    const [row] = await this.deps.context.sql`
      select
        (select count(*)::int from wager_transactions where kind <> 'OPENING') as transactions,
        (select count(*)::int from wager_transactions where kind <> 'OPENING' and status <> 'PROCESSED') as not_processed,
        (select count(*)::int from pending_references) as pending_references,
        (select count(*)::int from outbox_messages where published_at is null) as unpublished`;
    const queue = await this.deps.harness.messagesInQueue();
    return {
      transactions: row.transactions,
      not_processed: row.not_processed,
      pending_references: row.pending_references,
      unpublished: row.unpublished,
      queueVisible: queue.visible,
      queueInFlight: queue.inFlight,
    };
  }
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
