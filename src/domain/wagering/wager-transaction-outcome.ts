import type { Money } from "../shared/money/money";
import type { FailureCode } from "./failure-code";
import type { WagerTransactionStatus } from "./wager-transaction-status";

export interface WagerTransactionOutcome {
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId: string | undefined;
  readonly failureCode: FailureCode | undefined;
  readonly observedBalance: Money | undefined;
  readonly processedAt: Date | undefined;
}
