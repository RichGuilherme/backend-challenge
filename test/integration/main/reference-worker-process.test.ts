import { afterAll, beforeAll, describe, test } from "bun:test";
import { DEFAULT_PENDING_REFERENCE_POLICY } from "../../../src/application/wagering/pending-reference";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { testDatabaseConfig } from "../../support/database";
import { ServiceProcess, expectCleanShutdown, type TerminatedService } from "../../support/service-process";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

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

    const service = new ServiceProcess("reference-worker", {
      DB_NAME: testDatabaseConfig().name,
      PENDING_REFERENCE_POLL_INTERVAL_MS: "100",
    });
    let terminated!: Promise<TerminatedService>;

    try {
      const deadline = Date.now() + 15_000;
      while ((await statusOf(refund.transactionId)) !== "PROCESSED") {
        if (Date.now() > deadline) throw new Error("reversão não foi resolvida no prazo");
        await Bun.sleep(100);
      }
      await service.expectOperational();
    } finally {
      terminated = service.terminate();
    }

    expectCleanShutdown(await terminated, "reference-worker iniciado", "reference-worker encerrado");
    await expectWalletMatchesLedger(context.sql, wallet.id);
  }, 30_000);
});
