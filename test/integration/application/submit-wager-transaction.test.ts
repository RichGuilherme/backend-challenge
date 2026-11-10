import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GetWagerTransactionUseCase } from "../../../src/application/wagering/get-wager-transaction.use-case";
import {
  SubmitWagerTransactionUseCase,
  type SubmitWagerTransactionCommand,
} from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { IdempotencyConflictError, WagerTransactionNotFoundError } from "../../../src/application/wagering/wagering.errors";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { WalletNotFoundError, WalletPlayerMismatchError } from "../../../src/application/wallet/wallet.errors";
import { FailureCode } from "../../../src/domain/wagering/failure-code";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../../src/domain/wagering/wager-transaction-status";
import { InvalidWagerTransactionError } from "../../../src/domain/wagering/wager-transaction.errors";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

let context: TestContext;
let openWallet: OpenWalletUseCase;
let submit: SubmitWagerTransactionUseCase;
let getTransaction: GetWagerTransactionUseCase;

beforeAll(async () => {
  context = await createTestContext();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
  submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
  getTransaction = new GetWagerTransactionUseCase(context.unitOfWork);
});

afterAll(() => context?.close());

const open = (amount = "100.00"): Promise<WalletView> =>
  openWallet.execute({ playerId: `player-${crypto.randomUUID()}`, correlationId: "test-correlation", initialBalance: { amount, currency: "BRL" } });

const command = (wallet: WalletView, overrides: Partial<SubmitWagerTransactionCommand> = {}) =>
  submitCommand(wallet.id, wallet.playerId, overrides);

async function walletState(walletId: string) {
  const [row] = await context.sql`
    select w.balance, w.version,
      (select count(*)::int from wallet_ledger_entries e where e.wallet_id = w.id) as entries,
      (select count(*)::int from wager_transactions t where t.wallet_id = w.id) as transactions
    from wallets w where w.id = ${walletId}`;
  return row as { balance: string; version: number; entries: number; transactions: number };
}

describe("SubmitWagerTransactionUseCase", () => {
  describe("BET, WIN e LOSS", () => {
    test("BET debita e responde no formato do README", async () => {
      const wallet = await open("1000.00");

      const result = await submit.execute(command(wallet, { money: { amount: "25.00", currency: "BRL" } }));

      expect(result).toEqual({
        transactionId: result.transactionId,
        status: WagerTransactionStatus.Processed,
        balance: { amount: "975.00", currency: "BRL" },
        failureCode: undefined,
        idempotentReplay: false,
      });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "975.00", version: 2, entries: 2 });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("WIN credita", async () => {
      const wallet = await open();
      const result = await submit.execute(
        command(wallet, { kind: WagerTransactionKind.Win, money: { amount: "60.00", currency: "BRL" } }),
      );
      expect(result.balance).toEqual({ amount: "160.00", currency: "BRL" });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("LOSS é processado sem mexer no saldo, na versão nem no ledger", async () => {
      const wallet = await open();
      const result = await submit.execute(command(wallet, { kind: WagerTransactionKind.Loss }));

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance).toEqual({ amount: "100.00", currency: "BRL" });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "100.00", version: 1, entries: 1, transactions: 2 });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("BET sem saldo é REJECTED, fica registrada e não debita", async () => {
      const wallet = await open("10.00");

      const result = await submit.execute(command(wallet, { money: { amount: "10.01", currency: "BRL" } }));

      expect(result).toMatchObject({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.InsufficientFunds,
        balance: { amount: "10.00", currency: "BRL" },
      });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "10.00", version: 1, transactions: 2 });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("moeda diferente da wallet é REJECTED com CURRENCY_MISMATCH", async () => {
      const wallet = await open();
      const result = await submit.execute(command(wallet, { money: { amount: "1.00", currency: "USD" } }));
      expect(result).toMatchObject({ status: WagerTransactionStatus.Rejected, failureCode: FailureCode.CurrencyMismatch });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });
  });

  describe("idempotência", () => {
    test("replay devolve o resultado original, inclusive o saldo daquele momento", async () => {
      const wallet = await open();
      const bet = command(wallet);
      const original = await submit.execute(bet);
      await submit.execute(command(wallet, { kind: WagerTransactionKind.Win, money: { amount: "60.00", currency: "BRL" } }));

      const replay = await submit.execute(bet);

      expect(replay).toEqual({ ...original, idempotentReplay: true });
      expect(replay.balance).toEqual({ amount: "75.00", currency: "BRL" });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "135.00", entries: 3 });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("replay de rejeição devolve a mesma rejeição", async () => {
      const wallet = await open("1.00");
      const bet = command(wallet);
      const original = await submit.execute(bet);
      expect(await submit.execute(bet)).toEqual({ ...original, idempotentReplay: true });
    });

    test("25.5 e 25.50 são a mesma operação", async () => {
      const wallet = await open();
      const bet = command(wallet, { money: { amount: "25.5", currency: "BRL" } });
      const original = await submit.execute(bet);
      const replay = await submit.execute({ ...bet, money: { amount: "25.50", currency: "BRL" } });
      expect(replay).toEqual({ ...original, idempotentReplay: true });
    });

    test("mesma chave com payload diferente é conflito e não aplica nada", async () => {
      const wallet = await open();
      const bet = command(wallet);
      await submit.execute(bet);

      const attempt = submit.execute({ ...bet, money: { amount: "30.00", currency: "BRL" } });

      await expect(attempt).rejects.toMatchObject({ reason: "PAYLOAD_MISMATCH" });
      await expect(attempt).rejects.toBeInstanceOf(IdempotencyConflictError);
      expect(await walletState(wallet.id)).toMatchObject({ balance: "75.00", transactions: 2 });
    });

    test("mesma transação do provedor com outra chave é conflito", async () => {
      const wallet = await open();
      const bet = command(wallet);
      await submit.execute(bet);

      const attempt = submit.execute({ ...bet, idempotencyKey: "outra-chave" });

      await expect(attempt).rejects.toMatchObject({ reason: "KEY_MISMATCH" });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "75.00", transactions: 2 });
    });
  });

  describe("reversões", () => {
    const reversal = (
      wallet: WalletView,
      kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
      reference: SubmitWagerTransactionCommand,
    ) =>
      command(wallet, {
        kind,
        money: reference.money,
        referenceExternalTransactionId: reference.externalTransactionId,
      });

    test("REFUND de BET processada devolve o valor e vincula a referência", async () => {
      const wallet = await open();
      const bet = command(wallet);
      const betResult = await submit.execute(bet);

      const result = await submit.execute(reversal(wallet, WagerTransactionKind.Refund, bet));

      expect(result).toMatchObject({ status: WagerTransactionStatus.Processed, balance: { amount: "100.00" } });
      const view = await getTransaction.byId(result.transactionId);
      expect(view.referenceTransactionId).toBe(betResult.transactionId);
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("segunda reversão da mesma referência, de qualquer tipo, é REFERENCE_ALREADY_REVERSED", async () => {
      const wallet = await open();
      const bet = command(wallet);
      await submit.execute(bet);
      await submit.execute(reversal(wallet, WagerTransactionKind.Refund, bet));

      const second = await submit.execute(reversal(wallet, WagerTransactionKind.Rollback, bet));

      expect(second).toMatchObject({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.ReferenceAlreadyReversed,
        balance: { amount: "100.00" },
      });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("ROLLBACK de WIN já gasto é REVERSAL_INSUFFICIENT_FUNDS", async () => {
      const wallet = await open("0");
      const win = command(wallet, { kind: WagerTransactionKind.Win, money: { amount: "60.00", currency: "BRL" } });
      await submit.execute(win);
      await submit.execute(command(wallet, { money: { amount: "50.00", currency: "BRL" } }));

      const result = await submit.execute(reversal(wallet, WagerTransactionKind.Rollback, win));

      expect(result).toMatchObject({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.ReversalInsufficientFunds,
        balance: { amount: "10.00" },
      });
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("REFUND antes da BET fica PENDING_REFERENCE e não mexe no saldo", async () => {
      const wallet = await open();
      const futureBet = command(wallet);

      const result = await submit.execute(reversal(wallet, WagerTransactionKind.Refund, futureBet));

      expect(result).toMatchObject({ status: WagerTransactionStatus.PendingReference, balance: { amount: "100.00" } });
      expect(await walletState(wallet.id)).toMatchObject({ balance: "100.00", version: 1 });
    });
  });

  describe("entradas que não viram transação", () => {
    test("wallet inexistente", async () => {
      const attempt = submit.execute(submitCommand(crypto.randomUUID(), "player-x"));
      await expect(attempt).rejects.toBeInstanceOf(WalletNotFoundError);
    });

    test("wallet de outro player", async () => {
      const wallet = await open();
      await expect(submit.execute(submitCommand(wallet.id, "player-intruso"))).rejects.toBeInstanceOf(
        WalletPlayerMismatchError,
      );
      expect(await walletState(wallet.id)).toMatchObject({ transactions: 1 });
    });

    test("OPENING submetido de fora é inválido", async () => {
      const wallet = await open();
      await expect(submit.execute(command(wallet, { kind: WagerTransactionKind.Opening }))).rejects.toBeInstanceOf(
        InvalidWagerTransactionError,
      );
      expect(await walletState(wallet.id)).toMatchObject({ transactions: 1 });
    });
  });
});

describe("GetWagerTransactionUseCase", () => {
  test("consulta por id interno e por id do provedor", async () => {
    const wallet = await open();
    const bet = command(wallet);
    const result = await submit.execute(bet);

    const byId = await getTransaction.byId(result.transactionId);
    const byProvider = await getTransaction.byProviderReference(bet.providerId, bet.externalTransactionId);

    expect(byId).toEqual(byProvider);
    expect(byId).toMatchObject({
      id: result.transactionId,
      kind: "BET",
      status: "PROCESSED",
      money: { amount: "25.00", currency: "BRL" },
      observedBalance: { amount: "75.00", currency: "BRL" },
    });
  });

  test("transação inexistente", async () => {
    await expect(getTransaction.byId(crypto.randomUUID())).rejects.toBeInstanceOf(WagerTransactionNotFoundError);
  });
});
