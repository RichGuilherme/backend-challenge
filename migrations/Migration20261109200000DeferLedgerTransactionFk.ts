import { Migration } from "@mikro-orm/migrations";

export class Migration20261109200000DeferLedgerTransactionFk extends Migration {
  override up(): void {
    this.addSql(`
      alter table wallet_ledger_entries
        alter constraint wallet_ledger_entries_transaction_fk deferrable initially deferred;
    `);
  }

  override down(): void {
    this.addSql(`
      alter table wallet_ledger_entries
        alter constraint wallet_ledger_entries_transaction_fk not deferrable;
    `);
  }
}
