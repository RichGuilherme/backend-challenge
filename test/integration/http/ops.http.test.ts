import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestContext, type TestContext } from "../../support/application";
import { startTestHttpApp, type TestHttpApp } from "../../support/http";
import { expositionValue } from "../../support/metrics";

let context: TestContext;
let http: TestHttpApp;

beforeAll(async () => {
  context = await createTestContext();
  http = await startTestHttpApp();
});

afterAll(async () => {
  await http?.close();
  await context?.close();
});

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

async function openWalletAndBet(baseUrl: string, correlationId?: string): Promise<{ replayHeaders: Headers }> {
  const wallet = (await (
    await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" } }),
    })
  ).json()) as { id: string; playerId: string };
  const externalTransactionId = `tx-${crypto.randomUUID()}`;
  const submit = () =>
    fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `provider-a:${externalTransactionId}`,
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
      body: JSON.stringify({
        providerId: "provider-a",
        externalTransactionId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      }),
    });
  await submit();
  return { replayHeaders: (await submit()).headers };
}

describe("GET /health/live e /health/ready", () => {
  test("live responde 200", async () => {
    const response = await fetch(`${http.baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ status: "ok" });
  });

  test("ready responde 200 com Postgres e SQS no ar", async () => {
    const response = await fetch(`${http.baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      ready: true,
      dependencies: { postgres: { status: "up" }, sqs: { status: "up" } },
    });
  });

  test("ready falha com 503 quando o banco está parado, e live continua 200", async () => {
    const withoutDatabase = await startTestHttpApp({ DB_PORT: "1" });
    try {
      const ready = await fetch(`${withoutDatabase.baseUrl}/health/ready`);
      const live = await fetch(`${withoutDatabase.baseUrl}/health/live`);

      expect(ready.status).toBe(503);
      const body = (await json(ready)) as { ready: boolean; dependencies: Record<string, { status: string }> };
      expect(body.ready).toBe(false);
      expect(body.dependencies.postgres?.status).toBe("down");
      expect(body.dependencies.sqs).toEqual({ status: "up" });
      expect(live.status).toBe(200);
    } finally {
      await withoutDatabase.close();
    }
  });

  test("ready falha com 503 quando o SQS está parado", async () => {
    const withoutSqs = await startTestHttpApp({ AWS_ENDPOINT_URL: "http://127.0.0.1:1" });
    try {
      const ready = await fetch(`${withoutSqs.baseUrl}/health/ready`);

      expect(ready.status).toBe(503);
      const body = (await json(ready)) as { dependencies: Record<string, { status: string }> };
      expect(body.dependencies.postgres).toEqual({ status: "up" });
      expect(body.dependencies.sqs?.status).toBe("down");
    } finally {
      await withoutSqs.close();
    }
  });

  test("ready respeita o timeout configurado quando a dependência demora", async () => {
    const blackhole = await startTestHttpApp({
      AWS_ENDPOINT_URL: "http://10.255.255.1:4566",
      HEALTH_CHECK_TIMEOUT_MS: "300",
    });
    try {
      const startedAt = performance.now();
      const ready = await fetch(`${blackhole.baseUrl}/health/ready`);

      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(ready.status).toBe(503);
    } finally {
      await blackhole.close();
    }
  });
});

describe("GET /metrics", () => {
  test("expõe as métricas mínimas depois de uma aposta e de um replay", async () => {
    await openWalletAndBet(http.baseUrl);

    const response = await fetch(`${http.baseUrl}/metrics`);
    const exposition = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/plain");
    expect(expositionValue(exposition, "wagering_transactions_total", { kind: "BET", status: "PROCESSED" })).toBe(1);
    expect(expositionValue(exposition, "wagering_idempotent_replays_total")).toBe(1);
    expect(expositionValue(exposition, "wagering_processing_duration_seconds_count", { source: "http" })).toBe(2);
    expect(expositionValue(exposition, "wagering_lock_conflicts_total")).toBe(0);
    expect(expositionValue(exposition, "wagering_message_retries_total")).toBe(0);
    expect(expositionValue(exposition, "wagering_reconciliation_divergences_total")).toBe(0);
    expect(expositionValue(exposition, "wagering_outbox_lag_seconds")).toBeGreaterThanOrEqual(0);
  });

  test("não expõe nenhum identificador como label", async () => {
    const exposition = await (await fetch(`${http.baseUrl}/metrics`)).text();
    expect(exposition).not.toMatch(/walletId|transactionId|playerId|providerId|correlationId/);
  });
});

describe("X-Correlation-Id", () => {
  test("é devolvido igual quando válido", async () => {
    const { replayHeaders } = await openWalletAndBet(http.baseUrl, "corr-fornecido-1");
    expect(replayHeaders.get("x-correlation-id")).toBe("corr-fornecido-1");
  });

  test("o id gerado na entrada é o mesmo que chega ao evento publicado na outbox", async () => {
    const response = await fetch(`${http.baseUrl}/wallets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: crypto.randomUUID(), initialBalance: { amount: "10.00", currency: "BRL" } }),
    });
    const generated = response.headers.get("x-correlation-id");
    const wallet = (await response.json()) as { id: string };

    const [row] =
      await context.sql`select payload->>'correlationId' as correlation_id from outbox_messages where aggregate_id = ${wallet.id}`;

    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.correlation_id).toBe(generated);
  });

  test("é gerado quando ausente ou inválido", async () => {
    const absent = await fetch(`${http.baseUrl}/health/live`);
    const invalid = await fetch(`${http.baseUrl}/health/live`, {
      headers: { "x-correlation-id": "inválido com espaço" },
    });

    expect(absent.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(invalid.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
