import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/shared/money/money";
import { LedgerDirection } from "../../../../src/domain/wallet/ledger-direction";
import type { WalletLedgerEntry } from "../../../../src/domain/wallet/wallet-ledger-entry";
import { BusinessRuleError } from "../../../../src/domain/shared/business-rule.error";
import { Wallet, type WalletMovement } from "../../../../src/domain/wallet/wallet";
import {
  InsufficientFundsError,
  InvalidMovementAmountError,
  InvalidOpeningBalanceError,
  WalletCurrencyMismatchError,
} from "../../../../src/domain/wallet/wallet.errors";
import { rebuildBalanceFromLedger } from "../../../support/ledger";
import { brl, usd } from "../../../support/money";
import { captureError } from "../../../support/errors";

const openedAt = new Date("2026-11-09T12:00:00.000Z");
const later = new Date("2026-11-09T12:05:00.000Z");

function openWallet(initialBalance: Money) {
  return Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance,
    at: openedAt,
    opening: { transactionId: "tx-opening", entryId: "entry-opening" },
  });
}

let sequence = 0;
const movement = (money: Money): WalletMovement => {
  sequence += 1;
  return { entryId: `entry-${sequence}`, transactionId: `tx-${sequence}`, money, at: later };
};

function expectLedgerMatchesBalance(wallet: Wallet, entries: readonly WalletLedgerEntry[]): void {
  expect(rebuildBalanceFromLedger(entries, wallet.currency).equals(wallet.balance)).toBe(true);
}

describe("Wallet", () => {
  describe("open", () => {
    test("saldo inicial > 0: versão 1 e um lançamento CREDIT de abertura", () => {
      const { wallet, openingEntry } = openWallet(brl("100.00"));

      expect(wallet.id).toBe("wallet-1");
      expect(wallet.playerId).toBe("player-1");
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.toJSON()).toEqual({ amount: "100.00", currency: "BRL" });
      expect(wallet.version).toBe(1);
      expect(wallet.createdAt).toEqual(openedAt);
      expect(wallet.updatedAt).toEqual(openedAt);

      expect(openingEntry).toBeDefined();
      expect(openingEntry?.id).toBe("entry-opening");
      expect(openingEntry?.transactionId).toBe("tx-opening");
      expect(openingEntry?.walletId).toBe("wallet-1");
      expect(openingEntry?.walletVersion).toBe(1);
      expect(openingEntry?.direction).toBe(LedgerDirection.Credit);
      expect(openingEntry?.balanceBefore.isZero()).toBe(true);
      expect(openingEntry?.balanceAfter.equals(brl("100.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, [openingEntry!]);
    });

    test("saldo inicial zero: versão 1 e nenhum lançamento", () => {
      const { wallet, openingEntry } = openWallet(Money.zero("BRL"));

      expect(wallet.version).toBe(1);
      expect(wallet.balance.isZero()).toBe(true);
      expect(openingEntry).toBeUndefined();
      expectLedgerMatchesBalance(wallet, []);
    });

    test("saldo inicial negativo é recusado", () => {
      expect(() => openWallet(brl("10.00").negate())).toThrow(InvalidOpeningBalanceError);
    });
  });

  describe("debit", () => {
    test("diminui o saldo, incrementa a versão e devolve um lançamento DEBIT", () => {
      const { wallet, openingEntry } = openWallet(brl("100.00"));

      const entry = wallet.debit(movement(brl("80.00")));

      expect(wallet.balance.equals(brl("20.00"))).toBe(true);
      expect(wallet.version).toBe(2);
      expect(wallet.updatedAt).toEqual(later);
      expect(entry.direction).toBe(LedgerDirection.Debit);
      expect(entry.walletId).toBe("wallet-1");
      expect(entry.walletVersion).toBe(2);
      expect(entry.money.equals(brl("80.00"))).toBe(true);
      expect(entry.balanceBefore.equals(brl("100.00"))).toBe(true);
      expect(entry.balanceAfter.equals(brl("20.00"))).toBe(true);
      expect(entry.createdAt).toEqual(later);
      expectLedgerMatchesBalance(wallet, [openingEntry!, entry]);
    });

    test("pode zerar o saldo", () => {
      const { wallet } = openWallet(brl("100.00"));
      wallet.debit(movement(brl("100.00")));
      expect(wallet.balance.isZero()).toBe(true);
    });

    test("saldo insuficiente: InsufficientFundsError sem alterar saldo, versão nem updatedAt", () => {
      const { wallet } = openWallet(brl("100.00"));

      expect(() => wallet.debit(movement(brl("100.01")))).toThrow(InsufficientFundsError);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(openedAt);
    });

    test("cenário 100 − 80 − 80: a segunda aposta é recusada e o saldo fica 20.00", () => {
      const { wallet, openingEntry } = openWallet(brl("100.00"));

      const first = wallet.debit(movement(brl("80.00")));
      expect(() => wallet.debit(movement(brl("80.00")))).toThrow(InsufficientFundsError);

      expect(wallet.balance.equals(brl("20.00"))).toBe(true);
      expect(wallet.version).toBe(2);
      expectLedgerMatchesBalance(wallet, [openingEntry!, first]);
    });
  });

  describe("credit", () => {
    test("aumenta o saldo, incrementa a versão e devolve um lançamento CREDIT", () => {
      const { wallet, openingEntry } = openWallet(brl("20.00"));

      const entry = wallet.credit(movement(brl("60.00")));

      expect(wallet.balance.equals(brl("80.00"))).toBe(true);
      expect(wallet.version).toBe(2);
      expect(entry.direction).toBe(LedgerDirection.Credit);
      expect(entry.walletVersion).toBe(2);
      expect(entry.balanceBefore.equals(brl("20.00"))).toBe(true);
      expect(entry.balanceAfter.equals(brl("80.00"))).toBe(true);
      expectLedgerMatchesBalance(wallet, [openingEntry!, entry]);
    });

    test("funciona numa wallet aberta com saldo zero", () => {
      const { wallet } = openWallet(Money.zero("BRL"));
      const entry = wallet.credit(movement(brl("10.00")));
      expect(wallet.version).toBe(2);
      expectLedgerMatchesBalance(wallet, [entry]);
    });
  });

  describe("versão acompanha cada mudança de saldo", () => {
    test("sequência de movimentos: uma versão e um lançamento por mudança", () => {
      const { wallet, openingEntry } = openWallet(brl("100.00"));
      const entries = [openingEntry!];

      entries.push(wallet.debit(movement(brl("25.00"))));
      entries.push(wallet.credit(movement(brl("60.00"))));
      entries.push(wallet.debit(movement(brl("0.01"))));
      expect(() => wallet.debit(movement(brl("1000.00")))).toThrow(InsufficientFundsError);
      entries.push(wallet.credit(movement(brl("25.00"))));

      expect(wallet.version).toBe(5);
      expect(entries.map((entry) => entry.walletVersion)).toEqual([1, 2, 3, 4, 5]);
      expect(wallet.balance.equals(brl("159.99"))).toBe(true);
      expectLedgerMatchesBalance(wallet, entries);
    });
  });

  describe("moeda da operação", () => {
    test.each([
      ["debit", (wallet: Wallet, m: WalletMovement) => wallet.debit(m)],
      ["credit", (wallet: Wallet, m: WalletMovement) => wallet.credit(m)],
    ])("%s em USD numa wallet BRL é rejeição de negócio, sem efeito", (_op, operate) => {
      const { wallet } = openWallet(brl("100.00"));

      expect(() => operate(wallet, movement(usd("10.00")))).toThrow(WalletCurrencyMismatchError);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(wallet.version).toBe(1);
    });
  });

  describe("valor do movimento", () => {
    test.each([
      ["debit zero", (wallet: Wallet) => wallet.debit(movement(Money.zero("BRL")))],
      ["credit zero", (wallet: Wallet) => wallet.credit(movement(Money.zero("BRL")))],
      ["debit negativo", (wallet: Wallet) => wallet.debit(movement(brl("10.00").negate()))],
      ["credit negativo", (wallet: Wallet) => wallet.credit(movement(brl("10.00").negate()))],
    ])("%s é erro de programação, sem efeito", (_label, operate) => {
      const { wallet } = openWallet(brl("100.00"));

      expect(() => operate(wallet)).toThrow(InvalidMovementAmountError);
      expect(wallet.balance.equals(brl("100.00"))).toBe(true);
      expect(wallet.version).toBe(1);
    });
  });

  describe("classificação dos erros", () => {
    test("recusas de negócio estendem BusinessRuleError", () => {
      const { wallet } = openWallet(brl("10.00"));

      expect(captureError(() => wallet.debit(movement(brl("20.00"))))).toBeInstanceOf(BusinessRuleError);
      expect(captureError(() => wallet.debit(movement(usd("1.00"))))).toBeInstanceOf(BusinessRuleError);
    });

    test("erros de programação não estendem BusinessRuleError", () => {
      expect(new InvalidMovementAmountError(Money.zero("BRL"))).not.toBeInstanceOf(BusinessRuleError);
      expect(new InvalidOpeningBalanceError(Money.zero("BRL"))).not.toBeInstanceOf(BusinessRuleError);
    });
  });

  describe("datas isoladas", () => {
    test("alterar o Date de origem ou o devolvido não muda a wallet", () => {
      const openedSource = new Date("2026-11-09T12:00:00.000Z");
      const movedSource = new Date("2026-11-09T12:05:00.000Z");
      const { wallet } = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: brl("100.00"),
        at: openedSource,
        opening: { transactionId: "tx-opening", entryId: "entry-opening" },
      });
      wallet.debit({ entryId: "entry-x", transactionId: "tx-x", money: brl("1.00"), at: movedSource });

      openedSource.setUTCFullYear(1999);
      movedSource.setUTCFullYear(1999);
      wallet.createdAt.setUTCFullYear(1998);
      wallet.updatedAt.setUTCFullYear(1998);

      expect(wallet.createdAt.toISOString()).toBe("2026-11-09T12:00:00.000Z");
      expect(wallet.updatedAt.toISOString()).toBe("2026-11-09T12:05:00.000Z");
    });
  });

  describe("rehydrate", () => {
    test("reconstrói o estado persistido sem revalidar", () => {
      const wallet = Wallet.rehydrate({
        id: "wallet-9",
        playerId: "player-9",
        currency: "BRL",
        balance: brl("42.00"),
        version: 7,
        createdAt: openedAt,
        updatedAt: later,
      });

      expect(wallet.balance.equals(brl("42.00"))).toBe(true);
      expect(wallet.version).toBe(7);

      const entry = wallet.debit(movement(brl("2.00")));
      expect(entry.walletVersion).toBe(8);
      expect(entry.balanceBefore.equals(brl("42.00"))).toBe(true);
    });
  });
});
