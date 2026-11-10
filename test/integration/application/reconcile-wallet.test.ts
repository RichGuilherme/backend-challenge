import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import { ReconcileWalletUseCase } from "../../../src/application/wallet/reconcile-wallet.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { PrometheusDivergenceAlert } from "../../../src/infrastructure/observability/prometheus-divergence-alert";
import { SqlReconciliationQuery } from "../../../src/infrastructure/persistence/sql-reconciliation.query";
import { createTestContext, type TestContext } from "../../support/application";

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

describe("ReconcileWalletUseCase", () => {
  test("divergência é logada e contada na métrica; wallet consistente não conta", async () => {
    const registry = new Registry();
    const logs: { message: string; fields: Record<string, unknown> }[] = [];
    const alert = new PrometheusDivergenceAlert(registry, {
      info: () => undefined,
      warn: () => undefined,
      error: (message, fields = {}) => logs.push({ message, fields }),
    });
    const reconcile = new ReconcileWalletUseCase(new SqlReconciliationQuery(context.orm.em), alert);
    const open = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
    const healthy = await open.execute({
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount: "10.00", currency: "BRL" },
      correlationId: "corr-reconcile",
    });
    const broken = await open.execute({
      playerId: `player-${crypto.randomUUID()}`,
      initialBalance: { amount: "10.00", currency: "BRL" },
      correlationId: "corr-reconcile",
    });
    await context.sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update wallets set balance = 12.34 where id = ${broken.id}`;
    });

    await reconcile.execute(healthy.id);
    const report = await reconcile.execute(broken.id);

    expect(report.consistent).toBe(false);
    const counter = await registry.getSingleMetric("wagering_reconciliation_divergences_total")?.get();
    expect(counter?.values.map((value) => value.value)).toEqual([1]);
    expect(logs).toEqual([
      {
        message: "divergência entre saldo e ledger",
        fields: expect.objectContaining({
          walletId: broken.id,
          storedBalance: "12.34",
          calculatedBalance: "10.00",
          difference: "2.34",
        }),
      },
    ]);
  });
});
