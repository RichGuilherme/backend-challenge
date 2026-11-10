import type { WagerTransaction } from "./wager-transaction";

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | undefined>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined>;
  findByProviderReference(providerId: string, externalTransactionId: string): Promise<WagerTransaction | undefined>;
  hasProcessedReversalOf(referenceTransactionId: string): Promise<boolean>;
  insert(transaction: WagerTransaction): Promise<void>;
  update(transaction: WagerTransaction): Promise<void>;
}
