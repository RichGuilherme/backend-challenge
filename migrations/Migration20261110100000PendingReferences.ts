import { Migration } from "@mikro-orm/migrations";

export class Migration20261110100000PendingReferences extends Migration {
  override up(): void {
    this.addSql(`
      create table pending_references (
        transaction_id uuid primary key,
        attempts integer not null,
        next_attempt_at timestamptz not null,
        expires_at timestamptz not null,
        constraint pending_references_transaction_fk
          foreign key (transaction_id) references wager_transactions (id),
        constraint pending_references_attempts_non_negative check (attempts >= 0),
        constraint pending_references_next_attempt_until_expiry check (next_attempt_at <= expires_at)
      );
    `);
    this.addSql(`create index pending_references_due on pending_references (next_attempt_at);`);
  }

  override down(): void {
    this.addSql(`drop table pending_references;`);
  }
}
