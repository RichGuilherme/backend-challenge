import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { DEFAULT_PENDING_REFERENCE_POLICY } from "../../../src/application/wagering/pending-reference";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { testDatabaseConfig } from "../../support/database";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

const ENTRYPOINT = resolve(import.meta.dir, "../../../src/main/reference-worker.ts");

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

async function statusOf(transactionId: string): Promise<string> {
  const [row] = await context.sql`select status from wager_transactions where id = ${transactionId}`;
  return row.status;
}

describe("processo reference-worker", () => {
  test("resolve a reversão que chegou antes da referência e encerra no SIGTERM", async () => {
    const wallet = await new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock).execute({
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount: "100.00", currency: "BRL" },
      correlationId: "corr-reference-process",
    });
    const submit = new SubmitWagerTransactionUseCase(
      context.unitOfWork,
      context.ids,
      context.clock,
      DEFAULT_PENDING_REFERENCE_POLICY,
      () => 0,
    );
    const bet = submitCommand(wallet.id, wallet.playerId);
    const refund = await submit.execute(
      submitCommand(wallet.id, wallet.playerId, {
        kind: WagerTransactionKind.Refund,
        money: bet.money,
        referenceExternalTransactionId: bet.externalTransactionId,
      }),
    );
    await submit.execute(bet);

    const child = Bun.spawn(["bun", "run", ENTRYPOINT], {
      env: { ...process.env, DB_NAME: testDatabaseConfig().name, PENDING_REFERENCE_POLL_INTERVAL_MS: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const deadline = Date.now() + 15_000;
      while ((await statusOf(refund.transactionId)) !== "PROCESSED") {
        if (Date.now() > deadline) throw new Error("reversão não foi resolvida no prazo");
        await Bun.sleep(100);
      }
    } finally {
      child.kill("SIGTERM");
    }

    const exitCode = await child.exited;
    expect(await new Response(child.stderr).text()).not.toContain("falha no ciclo do worker");
    expect([0, 128 + 15]).toContain(exitCode);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  }, 30_000);
});
