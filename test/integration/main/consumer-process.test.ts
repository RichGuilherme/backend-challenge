import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { createTestContext, type TestContext } from "../../support/application";
import { testDatabaseConfig } from "../../support/database";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";
import { WagerQueueHarness, wagerEnvelope } from "../../support/wager-queue";

const ENTRYPOINT = resolve(import.meta.dir, "../../../src/main/consumer.ts");

let context: TestContext;
let harness: WagerQueueHarness;

beforeAll(async () => {
  context = await createTestContext();
  harness = await WagerQueueHarness.connect();
  await harness.purge();
});

afterAll(async () => {
  harness?.close();
  await context?.close();
});

describe("processo consumer", () => {
  test("consome a fila em processo próprio, aplica a transação e encerra no SIGTERM sem deixar mensagem presa", async () => {
    const wallet = await new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock).execute({
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount: "100.00", currency: "BRL" },
      correlationId: "corr-consumer-process",
    });
    const externalTransactionId = `transaction-${crypto.randomUUID()}`;
    await harness.send(
      wagerEnvelope(`msg-${crypto.randomUUID()}`, {
        providerId: "provider-a",
        externalTransactionId,
        idempotencyKey: `provider-a:${externalTransactionId}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "fortune-chimp",
        kind: "BET",
        money: { amount: "40.00", currency: "BRL" },
      }),
      wallet.id,
    );

    const child = Bun.spawn(["bun", "run", ENTRYPOINT], {
      env: { ...process.env, DB_NAME: testDatabaseConfig().name },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const [row] = await context.sql`select balance from wallets where id = ${wallet.id}`;
        if (row.balance === "60.00") break;
        if (Date.now() > deadline) throw new Error("mensagem não consumida no prazo");
        await Bun.sleep(100);
      }
    } finally {
      child.kill("SIGTERM");
    }

    const exitCode = await child.exited;
    expect(await new Response(child.stderr).text()).not.toContain("falha no ciclo do worker");
    expect([0, 128 + 15]).toContain(exitCode);
    expect(await harness.messagesInQueue()).toEqual({ visible: 0, inFlight: 0 });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  }, 30_000);
});
