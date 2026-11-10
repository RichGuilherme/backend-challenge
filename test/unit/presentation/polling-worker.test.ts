import { describe, expect, test } from "bun:test";
import { PollingWorker } from "../../../src/presentation/workers/polling-worker";

describe("PollingWorker", () => {
  test("repete a tarefa imediatamente enquanto há trabalho e espera o intervalo quando não há", async () => {
    let calls = 0;
    const worker = new PollingWorker(
      async () => ++calls <= 3,
      { pollIntervalMs: 50 },
      () => undefined,
    );

    worker.start();
    await Bun.sleep(20);
    const afterBurst = calls;
    await worker.stop();

    expect(afterBurst).toBe(4);
  });

  test("stop espera a tarefa em andamento terminar", async () => {
    let finished = false;
    const worker = new PollingWorker(
      async () => {
        await Bun.sleep(30);
        finished = true;
        return false;
      },
      { pollIntervalMs: 10_000 },
      () => undefined,
    );

    worker.start();
    await Bun.sleep(5);
    await worker.stop();

    expect(finished).toBe(true);
  });

  test("stop interrompe a espera sem aguardar o intervalo inteiro", async () => {
    const worker = new PollingWorker(
      async () => false,
      { pollIntervalMs: 60_000 },
      () => undefined,
    );
    worker.start();
    await Bun.sleep(5);

    const startedAt = performance.now();
    await worker.stop();

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  test("erro na tarefa é reportado e o loop continua", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const worker = new PollingWorker(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("banco fora");
        return false;
      },
      { pollIntervalMs: 5 },
      (error) => errors.push(error),
    );

    worker.start();
    await Bun.sleep(40);
    await worker.stop();

    expect(errors).toHaveLength(1);
    expect(calls).toBeGreaterThan(1);
  });
});
