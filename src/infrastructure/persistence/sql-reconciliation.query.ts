import type { EntityManager } from "@mikro-orm/postgresql";
import type { ReconciliationQuery, WalletBalanceSnapshot } from "../../application/ports/reconciliation.query";

interface SnapshotRow {
  currency: string;
  stored_balance: string;
  calculated_balance: string;
  checked_entries: number;
}

export class SqlReconciliationQuery implements ReconciliationQuery {
  constructor(private readonly em: EntityManager) {}

  async snapshot(walletId: string): Promise<WalletBalanceSnapshot | undefined> {
    const [row] = await this.em.getConnection().execute<SnapshotRow[]>(
      `select w.currency,
              w.balance::text as stored_balance,
              coalesce(sum(case e.direction when 'CREDIT' then e.amount else -e.amount end), 0)::numeric(20, 2)::text
                as calculated_balance,
              count(e.id)::int as checked_entries
         from wallets w
         left join wallet_ledger_entries e on e.wallet_id = w.id
        where w.id = ?
        group by w.id`,
      [walletId],
    );
    if (!row) return undefined;
    return {
      walletId,
      currency: row.currency.trim(),
      storedBalance: row.stored_balance,
      calculatedBalance: row.calculated_balance,
      checkedEntries: row.checked_entries,
    };
  }
}
