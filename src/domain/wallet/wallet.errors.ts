import { DomainError } from "../shared/domain-error";
import type { Money } from "../shared/money/money";
import { BusinessRuleError } from "../shared/business-rule.error";

export class InsufficientFundsError extends BusinessRuleError {
  constructor(
    readonly walletId: string,
    readonly balance: Money,
    readonly requested: Money,
  ) {
    super(`Saldo insuficiente na wallet ${walletId}: saldo ${balance}, solicitado ${requested}`);
  }
}

export class WalletCurrencyMismatchError extends BusinessRuleError {
  constructor(
    readonly walletId: string,
    readonly walletCurrency: string,
    readonly operationCurrency: string,
  ) {
    super(`Wallet ${walletId} é ${walletCurrency}, operação em ${operationCurrency}`);
  }
}

export class InvalidMovementAmountError extends DomainError {
  constructor(readonly money: Money) {
    super(`Movimento de wallet exige valor positivo: ${money}`);
  }
}

export class InvalidOpeningBalanceError extends DomainError {
  constructor(readonly money: Money) {
    super(`Saldo inicial não pode ser negativo: ${money}`);
  }
}

export class DuplicateWalletError extends DomainError {
  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`Já existe wallet ${currency} para o player ${playerId}`);
  }
}

export class WalletVersionConflictError extends DomainError {
  constructor(
    readonly walletId: string,
    readonly expectedVersion: number,
  ) {
    super(`Wallet ${walletId} não está na versão esperada ${expectedVersion}`);
  }
}
