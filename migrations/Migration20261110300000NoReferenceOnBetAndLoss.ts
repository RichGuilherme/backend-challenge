import { Migration } from "@mikro-orm/migrations";

export class Migration20261110300000NoReferenceOnBetAndLoss extends Migration {
  override up(): void {
    this.addSql(`
      alter table wager_transactions
        add constraint wager_transactions_bet_loss_have_no_reference
        check (kind not in ('BET', 'LOSS') or reference_external_transaction_id is null);
    `);
  }

  override down(): void {
    this.addSql(`alter table wager_transactions drop constraint wager_transactions_bet_loss_have_no_reference;`);
  }
}
