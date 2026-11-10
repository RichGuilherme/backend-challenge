import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_PENDING_REFERENCE_POLICY } from "../../../src/application/wagering/pending-reference";
import { ResolvePendingReferenceUseCase } from "../../../src/application/wagering/resolve-pending-reference.use-case";
import {
  SubmitWagerTransactionUseCase,
  type SubmitWagerTransactionCommand,
} from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { FailureCode } from "../../../src/domain/wagering/failure-code";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../../src/domain/wagering/wager-transaction-status";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";
import { outboxFor } from "../../support/outbox";
import { TestClock } from "../../support/test-clock";

const HOUR = 60 * 60 * 1_000;
const half = () => 0.5;

let context: TestContext;
let clock: TestClock;
let openWallet: OpenWalletUseCase;
let submit: SubmitWagerTransactionUseCase;
let resolve: ResolvePendingReferenceUseCase;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  clock = new TestClock();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, clock);
  submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, clock, DEFAULT_PENDING_REFERENCE_POLICY, half);
  resolve = new ResolvePendingReferenceUseCase(context.unitOfWork, context.ids, clock, DEFAULT_PENDING_REFERENCE_POLICY, half);
  await context.sql`delete from pending_references`;
});

afterAll(() => context?.close());

const open = (amount = "100.00"): Promise<WalletView> =>
  openWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: { amount, currency: "BRL" },
    correlationId: "corr-pending",
  });

function reversalOf(
  wallet: WalletView,
  reference: SubmitWagerTransactionCommand,
  overrides: Partial<SubmitWagerTransactionCommand> = {},
): SubmitWagerTransactionCommand {
  return submitCommand(wallet.id, wallet.playerId, {
    kind: WagerTransactionKind.Refund,
    money: reference.money,
    referenceExternalTransactionId: reference.externalTransactionId,
    ...overrides,
  });
}

async function scheduleOf(transactionId: string) {
  const [row] = await context.sql`
    select attempts, next_attempt_at, expires_at from pending_references where transaction_id = ${transactionId}`;
  return row as { attempts: number; next_attempt_at: Date; expires_at: Date } | undefined;
}

async function transactionRow(transactionId: string) {
  const [row] = await context.sql`
    select status, failure_code, reference_transaction_id, observed_balance from wager_transactions where id = ${transactionId}`;
  return row;
}

async function eventTypesOf(transactionId: string) {
  return (await outboxFor(context.sql, [transactionId])).map((row) => row.event_type);
}

describe("ResolvePendingReferenceUseCase", () => {
  test("submissão PENDING_REFERENCE agenda a primeira tentativa e a expiração em 24h", async () => {
    const wallet = await open();
    const pending = await submit.execute(reversalOf(wallet, submitCommand(wallet.id, wallet.playerId)));

    const schedule = await scheduleOf(pending.transactionId);

    expect(pending.status).toBe(WagerTransactionStatus.PendingReference);
    expect(schedule?.attempts).toBe(0);
    expect(schedule?.next_attempt_at).toEqual(new Date(clock.now().getTime() + 2_000));
    expect(schedule?.expires_at).toEqual(new Date(clock.now().getTime() + 24 * HOUR));
  });

  test("nada vencido: não processa nada", async () => {
    const wallet = await open();
    await submit.execute(reversalOf(wallet, submitCommand(wallet.id, wallet.playerId)));
    expect(await resolve.execute()).toBeUndefined();
  });

  test("REFUND antes da BET termina PROCESSED quando a BET chega", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    const refund = await submit.execute(reversalOf(wallet, bet));
    const betResult = await submit.execute(bet);
    clock.advance(2_000);

    expect(await resolve.execute()).toBe("PROCESSED");

    expect(await transactionRow(refund.transactionId)).toMatchObject({
      status: "PROCESSED",
      reference_transaction_id: betResult.transactionId,
      observed_balance: "100.00",
    });
    expect(await scheduleOf(refund.transactionId)).toBeUndefined();
    expect(await eventTypesOf(refund.transactionId)).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionProcessed",
    ]);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("replay da submissão pendente, depois de resolvida, devolve o estado final", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    const refundCommand = reversalOf(wallet, bet);
    await submit.execute(refundCommand);
    await submit.execute(bet);
    clock.advance(2_000);
    await resolve.execute();

    const replay = await submit.execute(refundCommand);

    expect(replay).toMatchObject({ status: "PROCESSED", balance: { amount: "100.00" }, idempotentReplay: true });
  });

  test("referência ainda ausente: reagenda com backoff, sem evento novo", async () => {
    const wallet = await open();
    const refund = await submit.execute(reversalOf(wallet, submitCommand(wallet.id, wallet.playerId)));
    clock.advance(2_000);

    expect(await resolve.execute()).toBe("RESCHEDULED");

    const schedule = await scheduleOf(refund.transactionId);
    expect(schedule?.attempts).toBe(1);
    expect(schedule?.next_attempt_at).toEqual(new Date(clock.now().getTime() + 4_000));
    expect(await transactionRow(refund.transactionId)).toMatchObject({ status: "PENDING_REFERENCE" });
    expect(await eventTypesOf(refund.transactionId)).toEqual(["WagerTransactionPendingReference"]);
  });

  test("TTL esgotado: REJECTED com REFERENCE_NOT_FOUND e evento", async () => {
    const wallet = await open();
    const refund = await submit.execute(reversalOf(wallet, submitCommand(wallet.id, wallet.playerId)));
    clock.advance(24 * HOUR);

    expect(await resolve.execute()).toBe("REJECTED");

    expect(await transactionRow(refund.transactionId)).toMatchObject({
      status: "REJECTED",
      failure_code: FailureCode.ReferenceNotFound,
      observed_balance: "100.00",
    });
    expect(await scheduleOf(refund.transactionId)).toBeUndefined();
    expect(await eventTypesOf(refund.transactionId)).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionRejected",
    ]);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("referência chega mas a regra de reversão falha: REJECTED com o código da regra", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    const partial = await submit.execute(reversalOf(wallet, bet, { money: { amount: "10.00", currency: "BRL" } }));
    await submit.execute(bet);
    clock.advance(2_000);

    expect(await resolve.execute()).toBe("REJECTED");

    expect(await transactionRow(partial.transactionId)).toMatchObject({
      status: "REJECTED",
      failure_code: FailureCode.ReversalAmountMismatch,
    });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("duas reversões esperando a mesma BET: a primeira processa, a segunda é REFERENCE_ALREADY_REVERSED", async () => {
    const wallet = await open();
    const bet = submitCommand(wallet.id, wallet.playerId);
    await submit.execute(reversalOf(wallet, bet));
    await submit.execute(reversalOf(wallet, bet, { kind: WagerTransactionKind.Rollback }));
    await submit.execute(bet);
    clock.advance(2_000);

    const outcomes = [await resolve.execute(), await resolve.execute()];

    expect(outcomes.sort()).toEqual(["PROCESSED", "REJECTED"]);
    const [counts] = await context.sql`
      select count(*) filter (where status = 'PROCESSED')::int as processed,
             count(*) filter (where failure_code = 'REFERENCE_ALREADY_REVERSED')::int as already_reversed
      from wager_transactions where wallet_id = ${wallet.id} and kind in ('REFUND', 'ROLLBACK')`;
    expect(counts).toEqual({ processed: 1, already_reversed: 1 });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });
});
