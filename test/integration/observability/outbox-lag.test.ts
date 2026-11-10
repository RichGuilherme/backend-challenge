import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import type { OutboxLagQuery } from "../../../src/application/ports/outbox-lag.query";
import { registerOutboxLagGauge } from "../../../src/infrastructure/observability/outbox-lag-gauge";
import { SqlOutboxLagQuery } from "../../../src/infrastructure/persistence/sql-outbox-lag.query";
import { createTestContext, type TestContext } from "../../support/application";
import { sampleOf } from "../../support/metrics";

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

beforeEach(async () => {
  await context.sql`delete from outbox_messages`;
});

async function enqueueAt(secondsAgo: number, published = false): Promise<void> {
  const id = crypto.randomUUID();
  await context.sql`
    insert into outbox_messages (id, aggregate_id, partition_key, event_type, payload, occurred_at, attempts, next_attempt_at, published_at)
    values (${id}, 'agg', 'part', 'WalletBalanceChanged', '{}'::jsonb,
            now() - (${secondsAgo} || ' seconds')::interval, 0, now(),
            ${published ? context.sql`now()` : null})`;
}

async function lag(registry: Registry): Promise<number | undefined> {
  return sampleOf(registry, "wagering_outbox_lag_seconds");
}

describe("wagering_outbox_lag_seconds", () => {
  test("outbox vazia → 0", async () => {
    const registry = new Registry();
    registerOutboxLagGauge(registry, new SqlOutboxLagQuery(context.orm.em));
    expect(await lag(registry)).toBe(0);
  });

  test("é a idade da mensagem pendente mais antiga", async () => {
    await enqueueAt(10);
    await enqueueAt(90);
    await enqueueAt(30);
    const registry = new Registry();
    registerOutboxLagGauge(registry, new SqlOutboxLagQuery(context.orm.em));

    const value = (await lag(registry)) ?? 0;

    expect(value).toBeGreaterThanOrEqual(90);
    expect(value).toBeLessThan(100);
  });

  test("mensagens já publicadas não contam", async () => {
    await enqueueAt(500, true);
    await enqueueAt(20);
    const registry = new Registry();
    registerOutboxLagGauge(registry, new SqlOutboxLagQuery(context.orm.em));

    const value = (await lag(registry)) ?? 0;

    expect(value).toBeGreaterThanOrEqual(20);
    expect(value).toBeLessThan(30);
  });

  test("é calculado a cada scrape, sem depender do publicador", async () => {
    const registry = new Registry();
    registerOutboxLagGauge(registry, new SqlOutboxLagQuery(context.orm.em));
    expect(await lag(registry)).toBe(0);

    await enqueueAt(60);

    expect((await lag(registry)) ?? 0).toBeGreaterThanOrEqual(60);
  });

  test("falha na consulta vira NaN e não derruba o scrape das outras métricas", async () => {
    const registry = new Registry();
    const broken: OutboxLagQuery = {
      oldestPendingAgeSeconds: async () => {
        throw new Error("banco fora");
      },
    };
    registerOutboxLagGauge(registry, broken);

    const exposition = await registry.metrics();

    expect(exposition).toMatch(/wagering_outbox_lag_seconds nan/i);
  });
});
