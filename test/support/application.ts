import type { SQL } from "bun";
import type { MikroORM } from "@mikro-orm/postgresql";
import { MikroOrmUnitOfWork } from "../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { SystemClock } from "../../src/infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../../src/infrastructure/system/uuid-v7-id-generator";
import { connectTestDatabase, initTestOrm, recreateTestDatabase } from "./database";

export interface TestContext {
  orm: MikroORM;
  unitOfWork: MikroOrmUnitOfWork;
  ids: UuidV7IdGenerator;
  clock: SystemClock;
  sql: SQL;
  close(): Promise<void>;
}

export async function createTestContext(options: { lockTimeoutMs?: number } = {}): Promise<TestContext> {
  await recreateTestDatabase();
  const orm = await initTestOrm();
  await orm.migrator.up();
  const sql = connectTestDatabase();
  return {
    orm,
    unitOfWork: new MikroOrmUnitOfWork(orm, options.lockTimeoutMs ?? 5_000),
    ids: new UuidV7IdGenerator(),
    clock: new SystemClock(),
    sql,
    async close() {
      await sql.close();
      await orm.close(true);
    },
  };
}
