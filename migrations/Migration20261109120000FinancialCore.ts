import { Migration } from "@mikro-orm/migrations";

const KINDS = "'OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'";
const STATUSES = "'PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'";
const TERMINAL_STATUSES = "'PROCESSED', 'REJECTED', 'FAILED'";
const REVERSAL_KINDS = "'REFUND', 'ROLLBACK'";
const FAILURE_CODES = [
  "INSUFFICIENT_FUNDS",
  "REVERSAL_INSUFFICIENT_FUNDS",
  "CURRENCY_MISMATCH",
  "REFERENCE_NOT_FOUND",
  "REFERENCE_MISMATCH",
  "INVALID_REFERENCE_KIND",
  "REFERENCE_NOT_PROCESSED",
  "REFERENCE_ALREADY_REVERSED",
  "REVERSAL_AMOUNT_MISMATCH",
]
  .map((code) => `'${code}'`)
  .join(", ");

export class Migration20261109120000FinancialCore extends Migration {
  override up(): void {
    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id text not null,
        currency char(3) not null,
        balance numeric(20, 2) not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint wallets_player_currency_unique unique (player_id, currency),
        constraint wallets_currency_format check (currency ~ '^[A-Z]{3}$'),
        constraint wallets_balance_non_negative check (balance >= 0),
        constraint wallets_version_positive check (version >= 1)
      );
    `);

    this.addSql(`
      create table wager_transactions (
        id uuid primary key,
        provider_id text not null,
        external_transaction_id text not null,
        idempotency_key text not null,
        payload_hash text not null,
        wallet_id uuid not null,
        player_id text not null,
        round_id text not null,
        game_id text not null,
        kind text not null,
        amount numeric(20, 2) not null,
        currency char(3) not null,
        reference_external_transaction_id text,
        reference_transaction_id uuid,
        status text not null,
        failure_code text,
        observed_balance numeric(20, 2),
        processed_at timestamptz,
        created_at timestamptz not null,
        constraint wager_transactions_wallet_fk foreign key (wallet_id) references wallets (id),
        constraint wager_transactions_reference_fk
          foreign key (reference_transaction_id) references wager_transactions (id),
        constraint wager_transactions_provider_external_unique unique (provider_id, external_transaction_id),
        constraint wager_transactions_idempotency_key_unique unique (idempotency_key),
        constraint wager_transactions_kind_valid check (kind in (${KINDS})),
        constraint wager_transactions_status_valid check (status in (${STATUSES})),
        constraint wager_transactions_failure_code_valid check (failure_code in (${FAILURE_CODES})),
        constraint wager_transactions_amount_positive check (amount > 0),
        constraint wager_transactions_currency_format check (currency ~ '^[A-Z]{3}$'),
        constraint wager_transactions_observed_balance_non_negative check (observed_balance >= 0),
        constraint wager_transactions_opening_internal_provider
          check ((kind = 'OPENING') = (provider_id = 'internal')),
        constraint wager_transactions_reversal_requires_reference
          check (kind not in (${REVERSAL_KINDS}) or reference_external_transaction_id is not null),
        constraint wager_transactions_processed_reversal_has_reference
          check (status <> 'PROCESSED' or kind not in (${REVERSAL_KINDS}) or reference_transaction_id is not null),
        constraint wager_transactions_failure_code_matches_status
          check ((status in ('REJECTED', 'FAILED')) = (failure_code is not null)),
        constraint wager_transactions_observed_balance_matches_status
          check ((status in ('PROCESSED', 'REJECTED')) = (observed_balance is not null)),
        constraint wager_transactions_processed_at_matches_status
          check ((status in (${TERMINAL_STATUSES})) = (processed_at is not null))
      );
    `);

    this.addSql(`
      create unique index wager_transactions_single_reversal_per_reference
        on wager_transactions (reference_transaction_id)
        where kind in (${REVERSAL_KINDS}) and status = 'PROCESSED';
    `);
    this.addSql(`
      create index wager_transactions_pending_reference_lookup
        on wager_transactions (provider_id, reference_external_transaction_id)
        where status = 'PENDING_REFERENCE';
    `);
    this.addSql(`create index wager_transactions_wallet on wager_transactions (wallet_id);`);

    this.addSql(`
      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null,
        transaction_id uuid not null,
        wallet_version integer not null,
        direction text not null,
        amount numeric(20, 2) not null,
        balance_before numeric(20, 2) not null,
        balance_after numeric(20, 2) not null,
        created_at timestamptz not null,
        constraint wallet_ledger_entries_wallet_fk foreign key (wallet_id) references wallets (id),
        constraint wallet_ledger_entries_transaction_fk
          foreign key (transaction_id) references wager_transactions (id),
        constraint wallet_ledger_entries_transaction_unique unique (wallet_id, transaction_id),
        constraint wallet_ledger_entries_version_unique unique (wallet_id, wallet_version),
        constraint wallet_ledger_entries_version_positive check (wallet_version >= 1),
        constraint wallet_ledger_entries_direction_valid check (direction in ('DEBIT', 'CREDIT')),
        constraint wallet_ledger_entries_amount_positive check (amount > 0),
        constraint wallet_ledger_entries_balances_non_negative check (balance_before >= 0 and balance_after >= 0),
        constraint wallet_ledger_entries_balanced check (
          (direction <> 'CREDIT' or balance_after = balance_before + amount)
          and (direction <> 'DEBIT' or balance_after = balance_before - amount)
        )
      );
    `);

    this.addSql(`
      create function reject_ledger_mutation() returns trigger language plpgsql as $$
      begin
        raise exception 'wallet_ledger_entries é imutável: % não permitido', tg_op;
      end;
      $$;
    `);
    this.addSql(`
      create trigger wallet_ledger_entries_immutable
        before update or delete on wallet_ledger_entries
        for each row execute function reject_ledger_mutation();
    `);
    this.addSql(`
      create trigger wallet_ledger_entries_no_truncate
        before truncate on wallet_ledger_entries
        for each statement execute function reject_ledger_mutation();
    `);

    this.addSql(`
      create function reject_wager_transaction_mutation() returns trigger language plpgsql as $$
      begin
        if tg_op <> 'UPDATE' then
          raise exception 'wager_transactions não aceita %', tg_op;
        end if;
        if old.status in (${TERMINAL_STATUSES}) then
          raise exception 'wager_transaction % está em estado terminal %', old.id, old.status;
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`
      create trigger wager_transactions_terminal_immutable
        before update or delete on wager_transactions
        for each row execute function reject_wager_transaction_mutation();
    `);
    this.addSql(`
      create trigger wager_transactions_no_truncate
        before truncate on wager_transactions
        for each statement execute function reject_wager_transaction_mutation();
    `);

    this.addSql(`
      create function assert_wallet_balance_has_ledger_entry() returns trigger language plpgsql as $$
      begin
        if new.version = 1 and new.balance = 0 then
          return null;
        end if;
        if not exists (
          select 1 from wallet_ledger_entries e
          where e.wallet_id = new.id and e.wallet_version = new.version and e.balance_after = new.balance
        ) then
          raise exception 'wallet % na versão % com saldo % não tem lançamento correspondente',
            new.id, new.version, new.balance;
        end if;
        return null;
      end;
      $$;
    `);
    this.addSql(`
      create constraint trigger wallets_balance_matches_ledger
        after insert or update on wallets
        deferrable initially deferred
        for each row execute function assert_wallet_balance_has_ledger_entry();
    `);
  }

  override down(): void {
    this.addSql(`drop table wallet_ledger_entries;`);
    this.addSql(`drop table wager_transactions;`);
    this.addSql(`drop table wallets;`);
    this.addSql(`drop function assert_wallet_balance_has_ledger_entry();`);
    this.addSql(`drop function reject_wager_transaction_mutation();`);
    this.addSql(`drop function reject_ledger_mutation();`);
  }
}
