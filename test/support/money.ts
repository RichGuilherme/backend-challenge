import { Money } from "../../src/domain/shared/money/money";

export const brl = (amount: string): Money => Money.from({ amount, currency: "BRL" });
export const usd = (amount: string): Money => Money.from({ amount, currency: "USD" });
