import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/shared/money/money";
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from "../../../../src/domain/shared/money/money.errors";
import { brl, usd } from "../../../support/money";


describe("Money", () => {
  describe("from: normalização para 2 casas", () => {
    test.each([
      ["25", "25.00"],
      ["25.5", "25.50"],
      ["25.50", "25.50"],
      ["0", "0.00"],
      ["0.01", "0.01"],
      ["999999999999999999.99", "999999999999999999.99"],
    ])("%p → %p", (input, expected) => {
      expect(brl(input).toJSON()).toEqual({ amount: expected, currency: "BRL" });
    });

    test("25.5 e 25.50 são o mesmo valor", () => {
      expect(brl("25.5").equals(brl("25.50"))).toBe(true);
    });
  });

  describe("from: rejeita entradas inválidas sem arredondar", () => {
    test.each([
      ["string vazia", ""],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      ["-Infinity", "-Infinity"],
      ["notação científica", "1e3"],
      ["notação científica com decimal", "2.5E2"],
      ["3 casas decimais", "25.001"],
      ["3 casas que arredondariam para cima", "25.999"],
      ["negativo", "-1.00"],
      ["negativo zero", "-0"],
      ["sinal positivo", "+5"],
      ["zero à esquerda", "007.50"],
      ["sem parte inteira", ".5"],
      ["ponto sem casas", "5."],
      ["espaços", " 5 "],
      ["vírgula decimal", "1,50"],
      ["hexadecimal", "0x10"],
      ["separador de milhar", "1_000"],
      ["mais de 18 dígitos inteiros", "1000000000000000000.00"],
    ])("%s (%p)", (_label, input) => {
      expect(() => brl(input)).toThrow(InvalidMoneyAmountError);
    });

    test("number em runtime é rejeitado", () => {
      expect(() => Money.from({ amount: 25 as unknown as string, currency: "BRL" })).toThrow(
        InvalidMoneyAmountError,
      );
    });
  });

  describe("from: moeda", () => {
    test.each([[""], ["brl"], ["BR"], ["BRLL"], ["R$"], ["B1L"]])("rejeita %p", (currency) => {
      expect(() => Money.from({ amount: "1.00", currency })).toThrow(InvalidCurrencyError);
    });

    test("aceita qualquer código ISO de 3 letras maiúsculas", () => {
      expect(usd("1.00").currency).toBe("USD");
    });
  });

  describe("precisão", () => {
    test("soma além de 2^53 centavos continua exata", () => {
      const result = brl("999999999999999999.99").subtract(brl("0.01")).add(brl("0.01"));
      expect(result.toJSON().amount).toBe("999999999999999999.99");
    });

    test("0.10 + 0.20 é exatamente 0.30", () => {
      expect(brl("0.10").add(brl("0.20")).equals(brl("0.30"))).toBe(true);
    });
  });

  describe("operações", () => {
    test("zero", () => {
      const zero = Money.zero("BRL");
      expect(zero.toJSON()).toEqual({ amount: "0.00", currency: "BRL" });
      expect(zero.isZero()).toBe(true);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isNegative()).toBe(false);
    });

    test("zero valida a moeda", () => {
      expect(() => Money.zero("brl")).toThrow(InvalidCurrencyError);
    });

    test("add e subtract devolvem nova instância e não alteram os operandos", () => {
      const a = brl("100.00");
      const b = brl("80.00");

      const sum = a.add(b);
      const diff = a.subtract(b);

      expect(sum).not.toBe(a);
      expect(diff).not.toBe(a);
      expect(sum.toJSON().amount).toBe("180.00");
      expect(diff.toJSON().amount).toBe("20.00");
      expect(a.toJSON().amount).toBe("100.00");
      expect(b.toJSON().amount).toBe("80.00");
    });

    test("subtract pode produzir negativo", () => {
      const result = brl("20.00").subtract(brl("80.00"));
      expect(result.toJSON().amount).toBe("-60.00");
      expect(result.isNegative()).toBe(true);
      expect(result.isPositive()).toBe(false);
      expect(result.isZero()).toBe(false);
    });

    test("negate inverte o sinal e preserva a moeda", () => {
      expect(brl("25.00").negate().toJSON()).toEqual({ amount: "-25.00", currency: "BRL" });
      expect(brl("25.00").negate().negate().equals(brl("25.00"))).toBe(true);
    });

    test("negate de zero continua zero, sem -0.00", () => {
      expect(Money.zero("BRL").negate().toJSON().amount).toBe("0.00");
    });

    test("valores negativos menores que 1 serializam com sinal", () => {
      expect(brl("0.05").negate().toJSON().amount).toBe("-0.05");
    });

    test("isLessThan", () => {
      expect(brl("79.99").isLessThan(brl("80.00"))).toBe(true);
      expect(brl("80.00").isLessThan(brl("80.00"))).toBe(false);
      expect(brl("80.01").isLessThan(brl("80.00"))).toBe(false);
    });

    test("equals compara valor e moeda", () => {
      expect(brl("10.00").equals(brl("10.00"))).toBe(true);
      expect(brl("10.00").equals(brl("10.01"))).toBe(false);
    });
  });

  describe("conflito de moeda", () => {
    test.each([
      ["add", (a: Money, b: Money) => a.add(b)],
      ["subtract", (a: Money, b: Money) => a.subtract(b)],
      ["isLessThan", (a: Money, b: Money) => a.isLessThan(b)],
      ["equals", (a: Money, b: Money) => a.equals(b)],
    ])("%s entre BRL e USD lança CurrencyMismatchError", (_op, operation) => {
      expect(() => operation(brl("10.00"), usd("10.00"))).toThrow(CurrencyMismatchError);
    });
  });

  describe("serialização", () => {
    test("toJSON devolve MoneyProps com amount string", () => {
      const json = brl("25.5").toJSON();
      expect(json).toEqual({ amount: "25.50", currency: "BRL" });
      expect(typeof json.amount).toBe("string");
    });

    test("JSON.stringify usa toJSON", () => {
      expect(JSON.stringify({ money: brl("25") })).toBe('{"money":{"amount":"25.00","currency":"BRL"}}');
    });

    test("toString", () => {
      expect(brl("25.5").toString()).toBe("25.50 BRL");
    });
  });
});
