import type { PendingReference } from "../wagering/pending-reference";

export interface PendingReferenceRepository {
  add(pending: PendingReference): Promise<void>;
  claimNextDue(now: Date): Promise<PendingReference | undefined>;
  save(pending: PendingReference): Promise<void>;
  remove(transactionId: string): Promise<void>;
}
