import { describe, expect, test } from "bun:test";
import type { DependencyCheck } from "../../../../src/application/ports/dependency-check";
import { ReadinessProbe } from "../../../../src/application/observability/readiness-probe";

const healthy = (name: string): DependencyCheck => ({ name, check: async () => undefined });
const broken = (name: string, message: string): DependencyCheck => ({
  name,
  check: async () => {
    throw new Error(message);
  },
});
const hanging = (name: string, onAbort?: () => void): DependencyCheck => ({
  name,
  check: (signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        onAbort?.();
        reject(new Error("abortado"));
      });
    }),
});

describe("ReadinessProbe", () => {
  test("todas as dependências no ar → pronto", async () => {
    const probe = new ReadinessProbe([healthy("postgres"), healthy("sqs")], 100);
    expect(await probe.check()).toEqual({
      ready: true,
      dependencies: { postgres: { status: "up" }, sqs: { status: "up" } },
    });
  });

  test("uma dependência falhando → não pronto, com o motivo, e a outra segue 'up'", async () => {
    const probe = new ReadinessProbe([healthy("postgres"), broken("sqs", "connection refused")], 100);
    expect(await probe.check()).toEqual({
      ready: false,
      dependencies: { postgres: { status: "up" }, sqs: { status: "down", reason: "connection refused" } },
    });
  });

  test("dependência que trava vira 'down' por timeout e recebe o sinal de cancelamento", async () => {
    let aborted = false;
    const probe = new ReadinessProbe([healthy("postgres"), hanging("sqs", () => (aborted = true))], 50);

    const startedAt = performance.now();
    const report = await probe.check();

    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(report.ready).toBe(false);
    expect(report.dependencies.sqs).toEqual({ status: "down", reason: "timeout após 50ms" });
    expect(aborted).toBe(true);
  });

  test("as verificações rodam em paralelo", async () => {
    const slow = (name: string): DependencyCheck => ({ name, check: () => Bun.sleep(100) });
    const probe = new ReadinessProbe([slow("a"), slow("b"), slow("c")], 1_000);

    const startedAt = performance.now();
    await probe.check();

    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  test("sem dependências está pronto", async () => {
    expect(await new ReadinessProbe([], 100).check()).toEqual({ ready: true, dependencies: {} });
  });

  test("timeout precisa ser positivo", () => {
    expect(() => new ReadinessProbe([], 0)).toThrow();
  });
});
