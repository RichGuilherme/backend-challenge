import type { UnitOfWork } from "../ports/unit-of-work";
import { toWagerTransactionView, type WagerTransactionView } from "./wager-transaction.view";
import { WagerTransactionNotFoundError } from "./wagering.errors";

export class GetWagerTransactionUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  byId(transactionId: string): Promise<WagerTransactionView> {
    return this.unitOfWork.run(async ({ transactions }) => {
      const transaction = await transactions.findById(transactionId);
      if (!transaction) throw new WagerTransactionNotFoundError(transactionId);
      return toWagerTransactionView(transaction);
    });
  }

  byProviderReference(providerId: string, externalTransactionId: string): Promise<WagerTransactionView> {
    return this.unitOfWork.run(async ({ transactions }) => {
      const transaction = await transactions.findByProviderReference(providerId, externalTransactionId);
      if (!transaction) throw new WagerTransactionNotFoundError(`${providerId}/${externalTransactionId}`);
      return toWagerTransactionView(transaction);
    });
  }
}
