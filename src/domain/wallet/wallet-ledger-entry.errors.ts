import { DomainError } from "../shared/domain-error";

export class UnbalancedLedgerEntryError extends DomainError {
  constructor(
    readonly direction: string,
    readonly money: string,
    readonly balanceBefore: string,
    readonly balanceAfter: string,
  ) {
    super(`Lançamento não fecha: ${balanceBefore} ${direction} ${money} ≠ ${balanceAfter}`);
  }
}

export class InvalidLedgerEntryError extends DomainError {}
