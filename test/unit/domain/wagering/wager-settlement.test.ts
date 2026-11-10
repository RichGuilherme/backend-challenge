import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/shared/money/money";
import { LedgerDirection } from "../../../../src/domain/wallet/ledger-direction";
import type { WalletLedgerEntry } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { InvalidLedgerEntryError } from "../../../../src/domain/wallet/wallet-ledger-entry.errors";
import { FailureCode } from "../../../../src/domain/wagering/failure-code";
import type { WagerTransaction } from "../../../../src/domain/wagering/wager-transaction";
import { WagerTransactionKind } from "../../../../src/domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../../../src/domain/wagering/wager-transaction-status";
import {
  WagerSettlement,
  type SettlementInput,
  type SettlementResult,
} from "../../../../src/domain/wagering/wager-settlement";
import { InvalidSettlementError } from "../../../../src/domain/wagering/wager-settlement.errors";
import { rebuildBalanceFromLedger } from "../../../support/ledger";
import { brl, usd } from "../../../support/money";
import { buildWagerTransaction, externalId } from "../../../support/wagering";

const openedAt = new Date("2026-11-09T11:00:00.000Z");
const settledAt = new Date("2026-11-09T12:00:01.000Z");
const settlement = new WagerSettlement();

function openWallet(initialBalance: Money) {
  const { wallet, openingEntry } = Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance,
    at: openedAt,
    opening: { transactionId: "tx-opening", entryId: "entry-opening" },
  });
  const ledger: WalletLedgerEntry[] = openingEntry ? [openingEntry] : [];
  return { wallet, ledger };
}

let entrySequence = 0;
function settle(
  wallet: Wallet,
  transaction: WagerTransaction,
  extra: Partial<Pick<SettlementInput, "reference" | "referenceAlreadyReversed">> = {},
): SettlementResult {
  entrySequence += 1;
  return settlement.settle({
    transaction,
    wallet,
    reference: undefined,
    referenceAlreadyReversed: false,
    entryId: `entry-${entrySequence}`,
    at: settledAt,
    ...extra,
  });
}

function settleInto(ledger: WalletLedgerEntry[], wallet: Wallet, transaction: WagerTransaction, extra = {}) {
  const result = settle(wallet, transaction, extra);
  if (result.status === WagerTransactionStatus.Processed && result.ledgerEntry) ledger.push(result.ledgerEntry);
  return result;
}

function expectLedgerMatchesBalance(wallet: Wallet, ledger: readonly WalletLedgerEntry[]): void {
  expect(rebuildBalanceFromLedger(ledger, wallet.currency).equals(wallet.balance)).toBe(true);
}

function processedBet(wallet: Wallet, ledger: WalletLedgerEntry[], money = brl("25.00")): WagerTransaction {
  const bet = buildWagerTransaction({ ...externalId("ext-bet"), money });
  settleInto(ledger, wallet, bet);
  expect(bet.status).toBe(WagerTransactionStatus.Processed);
  return bet;
}

function processedWin(wallet: Wallet, ledger: WalletLedgerEntry[], money = brl("60.00")): WagerTransaction {
  const win = buildWagerTransaction({ ...externalId("ext-win"), kind: WagerTransactionKind.Win, money });
  settleInto(ledger, wallet, win);
  expect(win.status).toBe(WagerTransactionStatus.Processed);
  return win;
}

const reversalOf = (
  kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  reference: WagerTransaction,
  money: Money = reference.money,
) =>
  buildWagerTransaction({
    ...externalId(`ext-${kind.toLowerCase()}-${reference.provider.externalTransactionId}`),
    kind,
    money,
    referenceExternalTransactionId: reference.provider.externalTransactionId,
  });

describe("WagerSettlement", () => {
  describe("BET", () => {
    test("com saldo: debita, processa e devolve um lançamento DEBIT", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = buildWagerTransaction({ money: brl("25.00") });

      const result = settleInto(ledger, wallet, bet);

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.status === WagerTransactionStatus.Processed && result.ledgerEntry?.direction).toBe(
        LedgerDirection.Debit,
      );
      expect(bet.status).toBe(WagerTransactionStatus.Processed);
      expect(bet.observedBalance?.equals(brl("75.00"))).toBe(true);
      expect(bet.processedAt).toEqual(settledAt);
      expect(wallet.balance.equals(brl("75.00"))).toBe(true);
      expect(wallet.version).toBe(2);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("sem saldo: REJECTED com INSUFFICIENT_FUNDS e nada muda", () => {
      const { wallet, ledger } = openWallet(brl("10.00"));
      const bet = buildWagerTransaction({ money: brl("10.01") });

      const result = settleInto(ledger, wallet, bet);

      expect(result).toEqual({ status: WagerTransactionStatus.Rejected, failureCode: FailureCode.InsufficientFunds });
      expect(bet.status).toBe(WagerTransactionStatus.Rejected);
      expect(bet.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(bet.observedBalance?.equals(brl("10.00"))).toBe(true);
      expect(wallet.balance.equals(brl("10.00"))).toBe(true);
      expect(wallet.version).toBe(1);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("cenário obrigatório: 100.00 e duas apostas de 80.00 → uma PROCESSED, uma REJECTED, saldo 20.00, um débito", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const first = buildWagerTransaction({ ...externalId("ext-a"), money: brl("80.00") });
      const second = buildWagerTransaction({ ...externalId("ext-b"), money: brl("80.00") });

      settleInto(ledger, wallet, first);
      settleInto(ledger, wallet, second);

      expect([first.status, second.status]).toEqual([
        WagerTransactionStatus.Processed,
        WagerTransactionStatus.Rejected,
      ]);
      expect(second.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(wallet.balance.equals(brl("20.00"))).toBe(true);
      expect(ledger.filter((entry) => entry.direction === LedgerDirection.Debit)).toHaveLength(1);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("WIN", () => {
    test("credita e devolve um lançamento CREDIT", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const win = buildWagerTransaction({ kind: WagerTransactionKind.Win, money: brl("60.00") });

      const result = settleInto(ledger, wallet, win);

      expect(result.status === WagerTransactionStatus.Processed && result.ledgerEntry?.direction).toBe(
        LedgerDirection.Credit,
      );
      expect(wallet.balance.equals(brl("160.00"))).toBe(true);
      expect(win.observedBalance?.equals(brl("160.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("LOSS", () => {
    test("processa sem lançamento, sem mudar saldo nem versão, e guarda o saldo observado", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const loss = buildWagerTransaction({ kind: WagerTransactionKind.Loss, money: brl("25.00") });

      const result = settleInto(ledger, wallet, loss);

      expect(result).toEqual({ status: WagerTransactionStatus.Processed, ledgerEntry: undefined });
      expect(loss.status).toBe(WagerTransactionStatus.Processed);
      expect(loss.observedBalance?.equals(brl("100.00"))).toBe(true);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(wallet.version).toBe(1);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("moeda da operação", () => {
    test.each([WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Loss])(
      "%s em USD numa wallet BRL → REJECTED com CURRENCY_MISMATCH e nada muda",
      (kind) => {
        const { wallet, ledger } = openWallet(brl("100.00"));
        const transaction = buildWagerTransaction({ kind, money: usd("10.00") });

        const result = settleInto(ledger, wallet, transaction);

        expect(result).toEqual({ status: WagerTransactionStatus.Rejected, failureCode: FailureCode.CurrencyMismatch });
        expect(transaction.observedBalance?.equals(brl("100.00"))).toBe(true);
        expect(wallet.version).toBe(1);
        expectLedgerMatchesBalance(wallet, ledger);
      },
    );
  });

  describe("REFUND", () => {
    test("de BET processada: credita o valor e vincula a referência", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);
      const refund = reversalOf(WagerTransactionKind.Refund, bet);

      const result = settleInto(ledger, wallet, refund, { reference: bet });

      expect(result.status === WagerTransactionStatus.Processed && result.ledgerEntry?.direction).toBe(
        LedgerDirection.Credit,
      );
      expect(refund.referenceTransactionId).toBe(bet.id);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("ROLLBACK", () => {
    test("de BET: devolve o valor (CREDIT)", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);

      settleInto(ledger, wallet, reversalOf(WagerTransactionKind.Rollback, bet), { reference: bet });

      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(ledger.at(-1)?.direction).toBe(LedgerDirection.Credit);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("de WIN: retira o prêmio (DEBIT)", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const win = processedWin(wallet, ledger);

      settleInto(ledger, wallet, reversalOf(WagerTransactionKind.Rollback, win), { reference: win });

      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(ledger.at(-1)?.direction).toBe(LedgerDirection.Debit);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("de REFUND: desfaz o reembolso (DEBIT)", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);
      const refund = reversalOf(WagerTransactionKind.Refund, bet);
      settleInto(ledger, wallet, refund, { reference: bet });

      settleInto(ledger, wallet, reversalOf(WagerTransactionKind.Rollback, refund), { reference: refund });

      expect(wallet.balance.equals(brl("75.00"))).toBe(true);
      expect(ledger.at(-1)?.direction).toBe(LedgerDirection.Debit);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("de WIN já gasto: REVERSAL_INSUFFICIENT_FUNDS, distinto de aposta sem saldo, e nada muda", () => {
      const { wallet, ledger } = openWallet(brl("0"));
      const win = processedWin(wallet, ledger, brl("60.00"));
      const spend = buildWagerTransaction({ ...externalId("ext-spend"), money: brl("50.00") });
      settleInto(ledger, wallet, spend);
      const rollback = reversalOf(WagerTransactionKind.Rollback, win);

      const result = settleInto(ledger, wallet, rollback, { reference: win });

      expect(result).toEqual({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.ReversalInsufficientFunds,
      });
      expect(FailureCode.ReversalInsufficientFunds).not.toBe(FailureCode.InsufficientFunds);
      expect(rollback.referenceTransactionId).toBe(win.id);
      expect(rollback.observedBalance?.equals(brl("10.00"))).toBe(true);
      expect(wallet.balance.equals(brl("10.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("referência", () => {
    test("ausente → PENDING_REFERENCE, sem efeito", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const refund = buildWagerTransaction({
        ...externalId("ext-refund"),
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
      });

      const result = settleInto(ledger, wallet, refund);

      expect(result).toEqual({ status: WagerTransactionStatus.PendingReference });
      expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
      expect(wallet.version).toBe(1);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("ainda não terminal → PENDING_REFERENCE, sem efeito", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const pendingBet = buildWagerTransaction(externalId("ext-bet"));
      const refund = reversalOf(WagerTransactionKind.Refund, pendingBet);

      const result = settleInto(ledger, wallet, refund, { reference: pendingBet });

      expect(result).toEqual({ status: WagerTransactionStatus.PendingReference });
      expect(wallet.version).toBe(1);
    });

    test("chega depois: PENDING_REFERENCE → PROCESSED", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const refund = buildWagerTransaction({
        ...externalId("ext-refund"),
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ext-bet",
      });
      settleInto(ledger, wallet, refund);

      const bet = processedBet(wallet, ledger);
      const result = settleInto(ledger, wallet, refund, { reference: bet });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(refund.referenceTransactionId).toBe(bet.id);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("já revertida → REFERENCE_ALREADY_REVERSED, vinculada à referência e sem efeito", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);
      const rollback = reversalOf(WagerTransactionKind.Rollback, bet);

      const result = settleInto(ledger, wallet, rollback, { reference: bet, referenceAlreadyReversed: true });

      expect(result).toEqual({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.ReferenceAlreadyReversed,
      });
      expect(rollback.referenceTransactionId).toBe(bet.id);
      expect(wallet.balance.equals(brl("75.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });

    test("regra de reversão violada → REJECTED com o failureCode da regra e vinculada à referência", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);
      const partialRefund = reversalOf(WagerTransactionKind.Refund, bet, brl("10.00"));

      const result = settleInto(ledger, wallet, partialRefund, { reference: bet });

      expect(result).toEqual({
        status: WagerTransactionStatus.Rejected,
        failureCode: FailureCode.ReversalAmountMismatch,
      });
      expect(partialRefund.referenceTransactionId).toBe(bet.id);
      expect(wallet.balance.equals(brl("75.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, ledger);
    });
  });

  describe("erros de programação", () => {
    test("transação já terminal não é liquidada de novo e a wallet não muda", () => {
      const { wallet, ledger } = openWallet(brl("100.00"));
      const bet = processedBet(wallet, ledger);

      expect(() => settle(wallet, bet)).toThrow(InvalidSettlementError);
      expect(wallet.balance.equals(brl("75.00"))).toBe(true);
      expect(wallet.version).toBe(2);
    });

    test("transação de outra wallet", () => {
      const { wallet } = openWallet(brl("100.00"));
      const bet = buildWagerTransaction({ walletId: "wallet-2" });

      expect(() => settle(wallet, bet)).toThrow(InvalidSettlementError);
      expect(bet.status).toBe(WagerTransactionStatus.Pending);
    });

    test("bug no ledger sobe como exceção e não vira rejeição", () => {
      const corrupted = Wallet.rehydrate({
        id: "wallet-1",
        playerId: "player-1",
        currency: "BRL",
        balance: brl("100.00"),
        version: 1.5,
        createdAt: openedAt,
        updatedAt: openedAt,
      });
      const bet = buildWagerTransaction();

      expect(() => settle(corrupted, bet)).toThrow(InvalidLedgerEntryError);
      expect(bet.status).toBe(WagerTransactionStatus.Pending);
    });

    test("transação de outro player", () => {
      const { wallet } = openWallet(brl("100.00"));
      const bet = buildWagerTransaction({ playerId: "player-2" });

      expect(() => settle(wallet, bet)).toThrow(InvalidSettlementError);
    });
  });
});
