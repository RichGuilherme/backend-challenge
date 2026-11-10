import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { PendingReferenceRepository } from "../../application/ports/pending-reference.repository";
import { PendingReference } from "../../application/wagering/pending-reference";
import { PendingReferenceRecord, type PendingReferenceRow } from "./records";

export class MikroOrmPendingReferenceRepository implements PendingReferenceRepository {
  constructor(private readonly em: EntityManager) {}

  async add(pending: PendingReference): Promise<void> {
    await this.em.insert(PendingReferenceRecord, toRow(pending));
  }

  async claimNextDue(now: Date): Promise<PendingReference | undefined> {
    const [row] = await this.em.find(
      PendingReferenceRecord,
      { nextAttemptAt: { $lte: now } },
      { orderBy: { nextAttemptAt: "asc" }, limit: 1, lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
    );
    return row ? PendingReference.rehydrate(row) : undefined;
  }

  async save(pending: PendingReference): Promise<void> {
    const { attempts, nextAttemptAt } = toRow(pending);
    await this.em.nativeUpdate(
      PendingReferenceRecord,
      { transactionId: pending.transactionId },
      { attempts, nextAttemptAt },
    );
  }

  async remove(transactionId: string): Promise<void> {
    await this.em.nativeDelete(PendingReferenceRecord, { transactionId });
  }
}

function toRow(pending: PendingReference): PendingReferenceRow {
  return {
    transactionId: pending.transactionId,
    attempts: pending.attempts,
    nextAttemptAt: pending.nextAttemptAt,
    expiresAt: pending.expiresAt,
  };
}
