import { Money, type MoneyProps } from "../../domain/shared/money/money";
import type { DivergenceAlert } from "../ports/divergence-alert";
import type { ReconciliationQuery } from "../ports/reconciliation.query";
import { WalletNotFoundError } from "./wallet.errors";

export interface ReconciliationReport {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly query: ReconciliationQuery,
    private readonly alert: DivergenceAlert,
  ) {}

  async execute(walletId: string): Promise<ReconciliationReport> {
    const snapshot = await this.query.snapshot(walletId);
    if (!snapshot) throw new WalletNotFoundError(walletId);

    const stored = signedMoney(snapshot.storedBalance, snapshot.currency);
    const calculated = signedMoney(snapshot.calculatedBalance, snapshot.currency);
    const difference = stored.subtract(calculated);
    const report: ReconciliationReport = {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent: difference.isZero(),
      checkedEntries: snapshot.checkedEntries,
    };

    if (!report.consistent) this.alert.divergenceDetected(report);
    return report;
  }
}

function signedMoney(amount: string, currency: string): Money {
  return amount.startsWith("-")
    ? Money.from({ amount: amount.slice(1), currency }).negate()
    : Money.from({ amount, currency });
}
