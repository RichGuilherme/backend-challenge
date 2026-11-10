import type { EntityManager } from "@mikro-orm/postgresql";
import type { OutboxLagQuery } from "../../application/ports/outbox-lag.query";

export class SqlOutboxLagQuery implements OutboxLagQuery {
  constructor(private readonly em: EntityManager) {}

  async oldestPendingAgeSeconds(): Promise<number> {
    const [row] = await this.em.getConnection().execute<{ lag_seconds: number }[]>(
      `select coalesce(extract(epoch from (now() - min(occurred_at))), 0)::float8 as lag_seconds
         from outbox_messages
        where published_at is null`,
    );
    return Math.max(0, row?.lag_seconds ?? 0);
  }
}
