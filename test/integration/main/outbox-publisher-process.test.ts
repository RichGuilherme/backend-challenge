import { afterAll, beforeAll, describe, test } from "bun:test";
import { resolve } from "node:path";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { createTestContext, type TestContext } from "../../support/application";
import { testDatabaseConfig } from "../../support/database";
import { ServiceProcess, expectCleanShutdown, type TerminatedService } from "../../support/service-process";
import { outboxByPartition } from "../../support/outbox";

const ENTRYPOINT = resolve(import.meta.dir, "../../../src/main/outbox-publisher.ts");

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

async function waitUntil(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condição não atingida no prazo");
    await Bun.sleep(100);
  }
}

describe("processo outbox-publisher", () => {
  test("roda isolado da API, publica a outbox e encerra no SIGTERM", async () => {
    const wallet = await new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock).execute({
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount: "10.00", currency: "BRL" },
      correlationId: "corr-process",
    });

    const service = new ServiceProcess(
      ENTRYPOINT,
      { DB_NAME: testDatabaseConfig().name, OUTBOX_POLL_INTERVAL_MS: "100" },
      "OPS_PORT",
    );
    let terminated!: Promise<TerminatedService>;

    try {
      await waitUntil(
        async () => (await outboxByPartition(context.sql, wallet.id)).every((row) => row.published_at !== null),
        15_000,
      );
      await service.expectOperational();
    } finally {
      terminated = service.terminate();
    }

    expectCleanShutdown(await terminated, "outbox-publisher iniciado", "outbox-publisher encerrado");
  }, 30_000);
});
