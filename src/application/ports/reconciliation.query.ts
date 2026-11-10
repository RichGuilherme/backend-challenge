export interface WalletBalanceSnapshot {
  walletId: string;
  currency: string;
  storedBalance: string;
  calculatedBalance: string;
  checkedEntries: number;
}

export interface ReconciliationQuery {
  snapshot(walletId: string): Promise<WalletBalanceSnapshot | undefined>;
}
