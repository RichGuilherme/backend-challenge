import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_PENDING_REFERENCE_POLICY } from "../../src/application/wagering/pending-reference";
import { ResolvePendingReferenceUseCase } from "../../src/application/wagering/resolve-pending-reference.use-case";
import { SubmitWagerTransactionUseCase } from "../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import { WagerTransactionKind } from "../../src/domain/wagering/wager-transaction-kind";
import { createTestContext, type TestContext } from "../support/application";
import { submitCommand } from "../support/commands";
import { expectAllWalletsMatchLedger } from "../support/ledger-invariant";
import { TestClock } from "../support/test-clock";

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext({ lockTimeoutMs: 10_000 });
});

afterAll(async () => {
  await expectAllWalletsMatchLedger(context.sql);
  await context?.close();
});

describe("workers de referência pendente concorrentes", () => {
  test("três workers em paralelo: cada reversão é aplicada exatamente uma vez", async () => {
    const clock = new TestClock();
    const half = () => 0.5;
    const openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, clock);
    const submit = new SubmitWagerTransactionUseCase(
      context.unitOfWork,
      context.ids,
      clock,
      DEFAULT_PENDING_REFERENCE_POLICY,
      half,
    );

    const refunds = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const wallet = await openWallet.execute({
          playerId: `player-${crypto.randomUUID()}`,
          initialBalance: { amount: "100.00", currency: "BRL" },
          correlationId: "corr-workers",
        });
        const bet = submitCommand(wallet.id, wallet.playerId);
        const refund = await submit.execute(
          submitCommand(wallet.id, wallet.playerId, {
            kind: WagerTransactionKind.Refund,
            money: bet.money,
            referenceExternalTransactionId: bet.externalTransactionId,
          }),
        );
        await submit.execute(bet);
        return refund.transactionId;
      }),
    );
    clock.advance(2_000);

    const worker = () =>
      new ResolvePendingReferenceUseCase(
        context.unitOfWork,
        context.ids,
        clock,
        DEFAULT_PENDING_REFERENCE_POLICY,
        half,
      );
    const drain = async (resolver: ResolvePendingReferenceUseCase) => {
      const outcomes: string[] = [];
      for (let outcome = await resolver.execute(); outcome; outcome = await resolver.execute()) outcomes.push(outcome);
      return outcomes;
    };

    const outcomes = (await Promise.all([drain(worker()), drain(worker()), drain(worker())])).flat();

    expect(outcomes).toHaveLength(20);
    expect(outcomes.every((outcome) => outcome === "PROCESSED")).toBe(true);
    const [row] = await context.sql`
      select
        count(*) filter (where t.status = 'PROCESSED')::int as processed,
        (select count(*)::int from wallet_ledger_entries e where e.transaction_id in ${context.sql(refunds)}) as entries,
        (select count(*)::int from pending_references) as still_pending
      from wager_transactions t where t.id in ${context.sql(refunds)}`;
    expect(row).toEqual({ processed: 20, entries: 20, still_pending: 0 });
  }, 60_000);
});
