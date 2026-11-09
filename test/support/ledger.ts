import { Money } from "../../src/domain/shared/money/money";
import { LedgerDirection } from "../../src/domain/wallet/ledger-direction";
import type { WalletLedgerEntry } from "../../src/domain/wallet/wallet-ledger-entry";

export function rebuildBalanceFromLedger(entries: readonly WalletLedgerEntry[], currency: string): Money {
  return entries.reduce(
    (balance, entry) =>
      entry.direction === LedgerDirection.Credit ? balance.add(entry.money) : balance.subtract(entry.money),
    Money.zero(currency),
  );
}
