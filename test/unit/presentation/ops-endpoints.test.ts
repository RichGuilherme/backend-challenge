import { describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import { ReadinessProbe } from "../../../src/application/observability/readiness-probe";
import type { DependencyCheck } from "../../../src/application/ports/dependency-check";
import { PrometheusMetrics } from "../../../src/infrastructure/observability/prometheus-metrics";
import { OpsEndpoints } from "../../../src/presentation/ops/ops-endpoints";

const up = (name: string): DependencyCheck => ({ name, check: async () => undefined });
const down = (name: string): DependencyCheck => ({
  name,
  check: async () => {
    throw new Error("indisponível");
  },
});

function endpoints(checks: DependencyCheck[]) {
  const registry = new Registry();
  const metrics = new PrometheusMetrics(registry);
  return { metrics, ops: new OpsEndpoints(new ReadinessProbe(checks, 100), registry) };
}

describe("OpsEndpoints", () => {
  test("live responde 200 sem consultar nenhuma dependência", async () => {
    const { ops } = endpoints([down("postgres")]);
    expect(await ops.live()).toEqual({ status: 200, contentType: "application/json", body: { status: "ok" } });
  });

  test("ready responde 200 com o estado de cada dependência", async () => {
    const { ops } = endpoints([up("postgres"), up("sqs")]);

    const response = await ops.ready();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ready: true,
      dependencies: { postgres: { status: "up" }, sqs: { status: "up" } },
    });
  });

  test("ready responde 503 quando qualquer dependência cai", async () => {
    const { ops } = endpoints([up("postgres"), down("sqs")]);

    const response = await ops.ready();

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ready: false,
      dependencies: { postgres: { status: "up" }, sqs: { status: "down", reason: "indisponível" } },
    });
  });

  test("metrics expõe o registry no formato de texto do Prometheus", async () => {
    const { ops, metrics } = endpoints([]);
    metrics.transactionSettled("BET", "PROCESSED");

    const response = await ops.metrics();

    expect(response.status).toBe(200);
    expect(response.contentType).toStartWith("text/plain");
    expect(response.body).toContain('wagering_transactions_total{kind="BET",status="PROCESSED"} 1');
  });
});
