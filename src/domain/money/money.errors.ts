export class InvalidMoneyAmountError extends Error {
  override readonly name = "InvalidMoneyAmountError";

  constructor(readonly amount: unknown) {
    super(`Valor monetário inválido: ${JSON.stringify(amount)}`);
  }
}

export class InvalidCurrencyError extends Error {
  override readonly name = "InvalidCurrencyError";

  constructor(readonly currency: unknown) {
    super(`Moeda inválida: ${JSON.stringify(currency)}`);
  }
}

export class CurrencyMismatchError extends Error {
  override readonly name = "CurrencyMismatchError";

  constructor(
    readonly expected: string,
    readonly received: string,
  ) {
    super(`Moedas diferentes: ${expected} e ${received}`);
  }
}
