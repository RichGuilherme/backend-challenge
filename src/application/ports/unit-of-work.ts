import type { WagerTransactionRepository } from "../../domain/wagering/wager-transaction.repository";
import type { WalletRepository } from "../../domain/wallet/wallet.repository";

export interface TransactionScope {
  wallets: WalletRepository;
  transactions: WagerTransactionRepository;
}

export interface UnitOfWork {
  run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}
