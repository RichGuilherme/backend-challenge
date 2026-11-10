import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { WagerTransactionRepository } from "../../domain/wagering/wager-transaction.repository";
import { DuplicateWagerTransactionError } from "../../domain/wagering/wager-transaction.errors";
import { WagerTransactionKind } from "../../domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { toWagerTransaction, toWagerTransactionRow } from "./mappers";
import { WagerTransactionRecord, type WagerTransactionRow } from "./records";

export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  findById(id: string): Promise<WagerTransaction | undefined> {
    return this.findOne({ id });
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | undefined> {
    return this.findOne({ idempotencyKey });
  }

  findByProviderReference(providerId: string, externalTransactionId: string): Promise<WagerTransaction | undefined> {
    return this.findOne({ providerId, externalTransactionId });
  }

  async hasProcessedReversalOf(referenceTransactionId: string): Promise<boolean> {
    const count = await this.em.count(WagerTransactionRecord, {
      referenceTransactionId,
      kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
      status: WagerTransactionStatus.Processed,
    });
    return count > 0;
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.insert(WagerTransactionRecord, toWagerTransactionRow(transaction));
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new DuplicateWagerTransactionError(
          transaction.idempotencyKey,
          transaction.provider.providerId,
          transaction.provider.externalTransactionId,
        );
      }
      throw error;
    }
  }

  async update(transaction: WagerTransaction): Promise<void> {
    const { referenceTransactionId, status, failureCode, observedBalance, processedAt } =
      toWagerTransactionRow(transaction);
    await this.em.nativeUpdate(
      WagerTransactionRecord,
      { id: transaction.id },
      { referenceTransactionId, status, failureCode, observedBalance, processedAt },
    );
  }

  private async findOne(where: Partial<WagerTransactionRow>): Promise<WagerTransaction | undefined> {
    const row = await this.em.findOne(WagerTransactionRecord, where);
    return row ? toWagerTransaction(row) : undefined;
  }
}
