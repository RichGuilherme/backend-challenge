import { Counter, type Registry } from "prom-client";
import type { DivergenceAlert } from "../../application/ports/divergence-alert";
import type { ReconciliationReport } from "../../application/wallet/reconcile-wallet.use-case";

export type StructuredLog = (entry: Record<string, unknown>) => void;

const writeErrorLog: StructuredLog = (entry) => console.error(JSON.stringify(entry));

export class PrometheusDivergenceAlert implements DivergenceAlert {
  private readonly divergences: Counter;

  constructor(
    registry: Registry,
    private readonly log: StructuredLog = writeErrorLog,
  ) {
    this.divergences = new Counter({
      name: "wagering_reconciliation_divergences_total",
      help: "Reconciliações em que o saldo gravado diverge do saldo reconstruído pelo ledger",
      registers: [registry],
    });
  }

  divergenceDetected(report: ReconciliationReport): void {
    this.divergences.inc();
    this.log({
      level: "error",
      msg: "divergência entre saldo e ledger",
      walletId: report.walletId,
      storedBalance: report.storedBalance.amount,
      calculatedBalance: report.calculatedBalance.amount,
      difference: report.difference.amount,
      checkedEntries: report.checkedEntries,
    });
  }
}
