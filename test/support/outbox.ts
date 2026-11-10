import type { SQL } from "bun";

export interface OutboxRow {
  id: string;
  aggregate_id: string;
  partition_key: string;
  event_type: string;
  payload: Record<string, unknown> & { data: Record<string, unknown> };
  attempts: number;
  next_attempt_at: Date;
  published_at: Date | null;
}

export async function outboxFor(sql: SQL, aggregateIds: readonly string[]): Promise<OutboxRow[]> {
  return sql`
    select id, aggregate_id, partition_key, event_type, payload, attempts, next_attempt_at, published_at
    from outbox_messages
    where aggregate_id in ${sql(aggregateIds as string[])}
    order by occurred_at, event_type`;
}

export async function outboxByPartition(sql: SQL, partitionKey: string): Promise<OutboxRow[]> {
  return sql`
    select id, aggregate_id, partition_key, event_type, payload, attempts, next_attempt_at, published_at
    from outbox_messages where partition_key = ${partitionKey}
    order by occurred_at, event_type`;
}

export async function markAllPublished(sql: SQL): Promise<void> {
  await sql`update outbox_messages set published_at = now() where published_at is null`;
}
