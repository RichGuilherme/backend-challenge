import type { Wallet } from "./wallet";
import type { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface WalletRepository {
  findById(id: string): Promise<Wallet | undefined>;
  lockById(id: string): Promise<Wallet | undefined>;
  existsForPlayer(playerId: string, currency: string): Promise<boolean>;
  insert(wallet: Wallet, openingEntry: WalletLedgerEntry | undefined): Promise<void>;
  update(wallet: Wallet, entry: WalletLedgerEntry): Promise<void>;
}
