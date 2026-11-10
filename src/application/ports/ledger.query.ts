import type { MoneyProps } from "../../domain/shared/money/money";

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  walletVersion: number;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerQuery {
  walletExists(walletId: string): Promise<boolean>;
  entriesAfter(walletId: string, afterVersion: number, limit: number): Promise<LedgerEntryView[]>;
}
