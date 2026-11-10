import type { EntityManager } from "@mikro-orm/postgresql";
import type { LedgerEntryView, LedgerQuery } from "../../application/ports/ledger.query";

interface LedgerRow {
  id: string;
  transaction_id: string;
  wallet_version: number;
  direction: string;
  amount: string;
  balance_before: string;
  balance_after: string;
  currency: string;
  created_at: Date;
}

export class SqlLedgerQuery implements LedgerQuery {
  constructor(private readonly em: EntityManager) {}

  async walletExists(walletId: string): Promise<boolean> {
    const rows = await this.em.getConnection().execute(`select 1 from wallets where id = ?`, [walletId]);
    return rows.length > 0;
  }

  async entriesAfter(walletId: string, afterVersion: number, limit: number): Promise<LedgerEntryView[]> {
    const rows = await this.em.getConnection().execute<LedgerRow[]>(
      `select e.id, e.transaction_id, e.wallet_version, e.direction, e.amount, e.balance_before, e.balance_after,
              w.currency, e.created_at
         from wallet_ledger_entries e
         join wallets w on w.id = e.wallet_id
        where e.wallet_id = ? and e.wallet_version > ?
        order by e.wallet_version
        limit ?`,
      [walletId, afterVersion, limit],
    );
    return rows.map(toView);
  }
}

function toView(row: LedgerRow): LedgerEntryView {
  const money = (amount: string) => ({ amount, currency: row.currency.trim() });
  return {
    id: row.id,
    transactionId: row.transaction_id,
    walletVersion: row.wallet_version,
    direction: row.direction,
    money: money(row.amount),
    balanceBefore: money(row.balance_before),
    balanceAfter: money(row.balance_after),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
