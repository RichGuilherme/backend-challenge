import type { SQL } from "bun";
import type { MikroORM } from "@mikro-orm/postgresql";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../src/application/wallet/wallet.view";
import { PostgresUnitOfWork } from "../../src/infrastructure/persistence/postgres-unit-of-work";
import { SystemClock } from "../../src/infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../../src/infrastructure/system/uuid-v7-id-generator";
import { connectTestDatabase, initTestOrm, recreateTestDatabase } from "./database";

export interface TestContext {
  orm: MikroORM;
  unitOfWork: PostgresUnitOfWork;
  ids: UuidV7IdGenerator;
  clock: SystemClock;
  sql: SQL;
  openWallet(amount?: string): Promise<WalletView>;
  close(): Promise<void>;
}

export async function createTestContext(options: { lockTimeoutMs?: number } = {}): Promise<TestContext> {
  await recreateTestDatabase();
  const orm = await initTestOrm();
  await orm.migrator.up();
  const sql = connectTestDatabase();
  const unitOfWork = new PostgresUnitOfWork(orm, options.lockTimeoutMs ?? 5_000);
  const ids = new UuidV7IdGenerator();
  const clock = new SystemClock();
  const opener = new OpenWalletUseCase(unitOfWork, ids, clock);
  return {
    orm,
    unitOfWork,
    ids,
    clock,
    sql,
    openWallet: (amount = "100.00") =>
      opener.execute({
        playerId: `player-${crypto.randomUUID()}`,
        correlationId: "test-correlation",
        initialBalance: { amount, currency: "BRL" },
      }),
    async close() {
      await sql.close();
      await orm.close(true);
    },
  };
}
