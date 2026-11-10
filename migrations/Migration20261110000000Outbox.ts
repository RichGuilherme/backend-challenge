import { Migration } from "@mikro-orm/migrations";

export class Migration20261110000000Outbox extends Migration {
  override up(): void {
    this.addSql(`
      create table outbox_messages (
        id uuid primary key,
        aggregate_id text not null,
        partition_key text not null,
        event_type text not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null default 0,
        next_attempt_at timestamptz not null,
        published_at timestamptz,
        constraint outbox_messages_attempts_non_negative check (attempts >= 0),
        constraint outbox_messages_payload_is_object check (jsonb_typeof(payload) = 'object')
      );
    `);
    this.addSql(`
      create index outbox_messages_due
        on outbox_messages (next_attempt_at, occurred_at, id)
        where published_at is null;
    `);
  }

  override down(): void {
    this.addSql(`drop table outbox_messages;`);
  }
}
