import { DeadlockException, DriverException, LockWaitTimeoutException } from "@mikro-orm/core";
import type { MikroORM } from "@mikro-orm/postgresql";
import type { TransactionScope, UnitOfWork } from "../../application/ports/unit-of-work";
import { TransientFailureError } from "../../application/shared/application-error";
import { MikroOrmOutboxRepository } from "./mikro-orm-outbox.repository";
import { MikroOrmWagerTransactionRepository } from "./mikro-orm-wager-transaction.repository";
import { MikroOrmWalletRepository } from "./mikro-orm-wallet.repository";

const LOCK_NOT_AVAILABLE = "55P03";

export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly orm: MikroORM,
    private readonly lockTimeoutMs: number,
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
          wallets: new MikroOrmWalletRepository(em),
          transactions: new MikroOrmWagerTransactionRepository(em),
          outbox: new MikroOrmOutboxRepository(em),
        });
      });
    } catch (error) {
      if (isTransient(error)) throw new TransientFailureError(`Falha transitória no banco: ${error.message}`);
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
