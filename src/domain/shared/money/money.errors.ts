import { DomainError } from "../domain-error";

export class InvalidMoneyAmountError extends DomainError {
  constructor(readonly amount: unknown) {
    super(`Valor monetário inválido: ${JSON.stringify(amount)}`);
  }
}

export class InvalidCurrencyError extends DomainError {
  constructor(readonly currency: unknown) {
    super(`Moeda inválida: ${JSON.stringify(currency)}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Moedas diferentes: ${expected} e ${received}`);
  }
}
