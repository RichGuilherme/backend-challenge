import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/shared/money/money";
import { CurrencyMismatchError } from "../../../../src/domain/shared/money/money.errors";
import { LedgerDirection } from "../../../../src/domain/wallet/ledger-direction";
import { WalletLedgerEntry, type CreateLedgerEntryProps } from "../../../../src/domain/wallet/wallet-ledger-entry";
import {
  InvalidLedgerEntryError,
  UnbalancedLedgerEntryError,
} from "../../../../src/domain/wallet/wallet-ledger-entry.errors";
import { brl, usd } from "../../../support/money";

const at = new Date("2026-11-09T12:00:00.000Z");

const debitProps = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  id: "entry-1",
  walletId: "wallet-1",
  transactionId: "tx-1",
  walletVersion: 2,
  direction: LedgerDirection.Debit,
  money: brl("80.00"),
  balanceBefore: brl("100.00"),
  balanceAfter: brl("20.00"),
  createdAt: at,
  ...overrides,
});

describe("WalletLedgerEntry", () => {
  describe("create valida a aritmética", () => {
    test("débito: before − money = after", () => {
      const entry = WalletLedgerEntry.create(debitProps());
      expect(entry.isBalanced()).toBe(true);
      expect(entry.balanceAfter.toJSON().amount).toBe("20.00");
    });

    test("crédito: before + money = after", () => {
      const entry = WalletLedgerEntry.create(
        debitProps({
          direction: LedgerDirection.Credit,
          money: brl("60.00"),
          balanceBefore: brl("20.00"),
          balanceAfter: brl("80.00"),
        }),
      );
      expect(entry.isBalanced()).toBe(true);
    });

    test("débito que não fecha lança UnbalancedLedgerEntryError", () => {
      expect(() => WalletLedgerEntry.create(debitProps({ balanceAfter: brl("20.01") }))).toThrow(
        UnbalancedLedgerEntryError,
      );
    });

    test("direção trocada não fecha", () => {
      expect(() => WalletLedgerEntry.create(debitProps({ direction: LedgerDirection.Credit }))).toThrow(
        UnbalancedLedgerEntryError,
      );
    });
  });

  describe("create rejeita lançamentos inválidos", () => {
    test.each([
      ["money zero", { money: brl("0"), balanceAfter: brl("100.00") }],
      ["money negativo", { money: brl("80.00").negate(), balanceAfter: brl("180.00") }],
      ["saldo final negativo", { money: brl("120.00"), balanceAfter: brl("20.00").negate() }],
      ["walletVersion zero", { walletVersion: 0 }],
      ["walletVersion fracionária", { walletVersion: 1.5 }],
    ])("%s", (_label, overrides) => {
      expect(() => WalletLedgerEntry.create(debitProps(overrides))).toThrow(InvalidLedgerEntryError);
    });

    test("moedas misturadas", () => {
      expect(() => WalletLedgerEntry.create(debitProps({ money: usd("80.00") }))).toThrow(CurrencyMismatchError);
    });
  });

  describe("imutabilidade estrutural", () => {
    test("não aceita alteração de campos em runtime", () => {
      const entry = WalletLedgerEntry.create(debitProps());
      expect(() => {
        (entry as unknown as { balanceAfter: Money }).balanceAfter = brl("999.00");
      }).toThrow(TypeError);
      expect(entry.balanceAfter.toJSON().amount).toBe("20.00");
    });

    test("não expõe métodos de transição", () => {
      const methods = Object.entries(Object.getOwnPropertyDescriptors(WalletLedgerEntry.prototype))
        .filter(([name, descriptor]) => name !== "constructor" && typeof descriptor.value === "function")
        .map(([name]) => name);
      expect(methods).toEqual(["isBalanced"]);
    });
  });

  describe("datas isoladas", () => {
    test("alterar o Date de origem ou o devolvido não muda o lançamento", () => {
      const source = new Date("2026-11-09T12:00:00.000Z");
      const entry = WalletLedgerEntry.create(debitProps({ createdAt: source }));

      source.setUTCFullYear(1999);
      entry.createdAt.setUTCFullYear(1998);

      expect(entry.createdAt.toISOString()).toBe("2026-11-09T12:00:00.000Z");
    });
  });

  describe("rehydrate", () => {
    test("reconstrói o estado persistido sem revalidar", () => {
      const entry = WalletLedgerEntry.rehydrate({ ...debitProps(), balanceAfter: brl("20.01") });
      expect(entry.balanceAfter.toJSON().amount).toBe("20.01");
      expect(entry.isBalanced()).toBe(false);
    });
  });
});
