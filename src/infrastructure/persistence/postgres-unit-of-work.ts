import { DeadlockException, DriverException, LockWaitTimeoutException } from "@mikro-orm/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import type { TransactionScope, UnitOfWork } from "../../application/ports/unit-of-work";
import { NO_METRICS, type Metrics } from "../../application/ports/metrics";
import { TransientFailureError } from "../../application/shared/application-error";
import { PostgresInboxRepository } from "./postgres-inbox.repository";
import { PostgresOutboxRepository } from "./postgres-outbox.repository";
import { PostgresPendingReferenceRepository } from "./postgres-pending-reference.repository";
import { PostgresWagerTransactionRepository } from "./postgres-wager-transaction.repository";
import { PostgresWalletRepository } from "./postgres-wallet.repository";

const LOCK_NOT_AVAILABLE = "55P03";

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(
    private readonly orm: MikroORM,
    private readonly lockTimeoutMs: number,
    private readonly metrics: Metrics = NO_METRICS,
  ) {
    if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
      throw new Error(`lock_timeout inválido: ${lockTimeoutMs}`);
    }
  }

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    try {
      return await this.orm.em.fork().transactional(async (em) => {
        await em.execute(`set local lock_timeout = '${this.lockTimeoutMs}ms'`);
        return work({
          wallets: new PostgresWalletRepository(em),
          transactions: new PostgresWagerTransactionRepository(em),
          outbox: new PostgresOutboxRepository(em),
          pendingReferences: new PostgresPendingReferenceRepository(em),
          inbox: new PostgresInboxRepository(em),
        });
      });
    } catch (error) {
      if (isTransient(error)) {
        this.metrics.lockConflict();
        throw new TransientFailureError(`Falha transitória no banco: ${error.message}`);
      }
      throw error;
    }
  }
}

function isTransient(error: unknown): error is DriverException {
  return (
    error instanceof DeadlockException ||
    error instanceof LockWaitTimeoutException ||
    (error instanceof DriverException && error.code === LOCK_NOT_AVAILABLE)
  );
}
