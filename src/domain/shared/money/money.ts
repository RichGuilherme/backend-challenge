import { CurrencyMismatchError, InvalidCurrencyError, InvalidMoneyAmountError } from "./money.errors";

export interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,2}))?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const CENTS_PER_UNIT = 100n;

export class Money {
  private constructor(
    private readonly cents: bigint,
    readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    const currency = Money.parseCurrency(props.currency);
    const { amount } = props;

    if (typeof amount !== "string") throw new InvalidMoneyAmountError(amount);

    const match = AMOUNT_PATTERN.exec(amount);
    if (!match) throw new InvalidMoneyAmountError(amount);

    const [, integerPart = "0", fractionPart = ""] = match;
    const cents = BigInt(integerPart) * CENTS_PER_UNIT + BigInt(fractionPart.padEnd(2, "0"));
    return new Money(cents, currency);
  }

  static zero(currency: string): Money {
    return new Money(0n, Money.parseCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  negate(): Money {
    return new Money(-this.cents, this.currency);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents === other.cents;
  }

  toJSON(): MoneyProps {
    return { amount: this.formatAmount(), currency: this.currency };
  }

  toString(): string {
    return `${this.formatAmount()} ${this.currency}`;
  }

  private formatAmount(): string {
    const sign = this.cents < 0n ? "-" : "";
    const absolute = this.cents < 0n ? -this.cents : this.cents;
    const units = absolute / CENTS_PER_UNIT;
    const fraction = (absolute % CENTS_PER_UNIT).toString().padStart(2, "0");
    return `${sign}${units}.${fraction}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) throw new CurrencyMismatchError(this.currency, other.currency);
  }

  private static parseCurrency(currency: unknown): string {
    if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidCurrencyError(currency);
    }
    return currency;
  }
}
