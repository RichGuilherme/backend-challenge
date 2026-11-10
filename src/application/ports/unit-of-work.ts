import type { WagerTransactionRepository } from "../../domain/wagering/wager-transaction.repository";
import type { WalletRepository } from "../../domain/wallet/wallet.repository";
import type { OutboxRepository } from "./outbox.repository";
import type { PendingReferenceRepository } from "./pending-reference.repository";

export interface TransactionScope {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
  outbox: OutboxRepository;
  pendingReferences: PendingReferenceRepository;
}

export interface UnitOfWork {
  run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}
