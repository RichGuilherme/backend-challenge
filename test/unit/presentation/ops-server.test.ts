import { afterEach, describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import { ReadinessProbe } from "../../../src/application/observability/readiness-probe";
import type { DependencyCheck } from "../../../src/application/ports/dependency-check";
import { PrometheusMetrics } from "../../../src/infrastructure/observability/prometheus-metrics";
import { OpsEndpoints } from "../../../src/presentation/ops/ops-endpoints";
import { OpsServer } from "../../../src/presentation/ops/ops-server";

let server: OpsServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function start(checks: DependencyCheck[]): Promise<string> {
  const registry = new Registry();
  new PrometheusMetrics(registry).idempotentReplay();
  server = new OpsServer(new OpsEndpoints(new ReadinessProbe(checks, 100), registry), 0);
  await server.start();
  return `http://127.0.0.1:${server.port}`;
}

describe("OpsServer", () => {
  test("serve live, ready e metrics por HTTP", async () => {
    const baseUrl = await start([{ name: "postgres", check: async () => undefined }]);

    const live = await fetch(`${baseUrl}/health/live`);
    const ready = await fetch(`${baseUrl}/health/ready`);
    const metrics = await fetch(`${baseUrl}/metrics`);

    expect([live.status, ready.status, metrics.status]).toEqual([200, 200, 200]);
    expect(await live.json()).toEqual({ status: "ok" });
    expect(await ready.json()).toEqual({ ready: true, dependencies: { postgres: { status: "up" } } });
    expect(await metrics.text()).toContain("wagering_idempotent_replays_total 1");
    expect(metrics.headers.get("content-type")).toStartWith("text/plain");
  });

  test("ready responde 503 com a dependência fora do ar", async () => {
    const baseUrl = await start([
      {
        name: "postgres",
        check: async () => {
          throw new Error("connection refused");
        },
      },
    ]);

    const ready = await fetch(`${baseUrl}/health/ready`);
    const live = await fetch(`${baseUrl}/health/live`);

    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      ready: false,
      dependencies: { postgres: { status: "down", reason: "connection refused" } },
    });
    expect(live.status).toBe(200);
  });

  test("rota desconhecida e método não suportado", async () => {
    const baseUrl = await start([]);

    expect((await fetch(`${baseUrl}/outra`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/metrics`, { method: "POST" })).status).toBe(404);
  });

  test("stop libera a porta", async () => {
    const baseUrl = await start([]);
    await server?.stop();
    server = undefined;
    await expect(fetch(`${baseUrl}/health/live`)).rejects.toThrow();
  });
});
