import { DomainError } from "../shared/domain-error";
import { BusinessRuleError } from "../shared/business-rule.error";
import type { FailureCode } from "./failure-code";
import type { WagerTransactionStatus } from "./wager-transaction-status";

export class WagerRuleViolationError extends BusinessRuleError {
  constructor(
    readonly failureCode: FailureCode,
    message: string,
  ) {
    super(message);
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(
    readonly transactionId: string,
    readonly status: WagerTransactionStatus,
    readonly action: string,
  ) {
    super(`Transação ${transactionId} em ${status} não aceita ${action}`);
  }
}

export class InvalidWagerTransactionError extends DomainError {}

export class DuplicateWagerTransactionError extends DomainError {
  constructor(
    readonly idempotencyKey: string,
    readonly providerId: string,
    readonly externalTransactionId: string,
  ) {
    super(`Transação já registrada: chave ${idempotencyKey} ou ${providerId}/${externalTransactionId}`);
  }
}
