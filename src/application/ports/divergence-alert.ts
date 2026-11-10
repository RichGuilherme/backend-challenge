import type { ReconciliationReport } from "../wallet/reconcile-wallet.use-case";

export interface DivergenceAlert {
  divergenceDetected(report: ReconciliationReport): void;
}
