import { Counter, type Registry } from "prom-client";
import type { DivergenceAlert } from "../../application/ports/divergence-alert";
import type { Logger } from "../../application/ports/logger";
import type { ReconciliationReport } from "../../application/wallet/reconcile-wallet.use-case";

export class PrometheusDivergenceAlert implements DivergenceAlert {
  private readonly divergences: Counter;

  constructor(
    registry: Registry,
    private readonly logger: Logger,
  ) {
    this.divergences = new Counter({
      name: "wagering_reconciliation_divergences_total",
      help: "Reconciliações em que o saldo gravado diverge do saldo reconstruído pelo ledger",
      registers: [registry],
    });
  }

  divergenceDetected(report: ReconciliationReport): void {
    this.divergences.inc();
    this.logger.error("divergência entre saldo e ledger", {
      walletId: report.walletId,
      storedBalance: report.storedBalance.amount,
      calculatedBalance: report.calculatedBalance.amount,
      difference: report.difference.amount,
      checkedEntries: report.checkedEntries,
    });
  }
}
