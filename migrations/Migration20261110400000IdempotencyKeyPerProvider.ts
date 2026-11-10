import { Migration } from "@mikro-orm/migrations";

export class Migration20261110400000IdempotencyKeyPerProvider extends Migration {
  override up(): void {
    this.addSql(`
      alter table wager_transactions drop constraint wager_transactions_idempotency_key_unique;
      alter table wager_transactions
        add constraint wager_transactions_provider_idempotency_key_unique unique (provider_id, idempotency_key);
    `);
  }

  override down(): void {
    this.addSql(`
      alter table wager_transactions drop constraint wager_transactions_provider_idempotency_key_unique;
      alter table wager_transactions
        add constraint wager_transactions_idempotency_key_unique unique (idempotency_key);
    `);
  }
}
