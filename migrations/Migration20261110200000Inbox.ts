import { Migration } from "@mikro-orm/migrations";

export class Migration20261110200000Inbox extends Migration {
  override up(): void {
    this.addSql(`
      create table inbox_messages (
        consumer_name text not null,
        message_id text not null,
        payload_hash text not null,
        received_at timestamptz not null,
        processed_at timestamptz,
        constraint inbox_messages_pk primary key (consumer_name, message_id)
      );
    `);
  }

  override down(): void {
    this.addSql(`drop table inbox_messages;`);
  }
}
