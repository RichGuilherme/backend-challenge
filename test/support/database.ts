import { SQL } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";
import { createOrmOptions } from "../../src/infrastructure/persistence/orm.config";
import { loadDatabaseConfig, type DatabaseConfig } from "../../src/shared/config/env";

const TEST_SUFFIX = "_test";

export function testDatabaseConfig(): DatabaseConfig {
  const config = loadDatabaseConfig();
  const name = config.name.endsWith(TEST_SUFFIX) ? config.name : `${config.name}${TEST_SUFFIX}`;
  return { ...config, name };
}

function connect(config: DatabaseConfig): SQL {
  return new SQL({
    hostname: config.host,
    port: config.port,
    database: config.name,
    username: config.user,
    password: config.password,
  });
}

export async function recreateTestDatabase(): Promise<void> {
  const config = testDatabaseConfig();
  const admin = connect({ ...config, name: "postgres" });
  try {
    await admin.unsafe(`drop database if exists "${config.name}" with (force)`);
    await admin.unsafe(`create database "${config.name}"`);
  } finally {
    await admin.close();
  }
}

export function connectTestDatabase(): SQL {
  return connect(testDatabaseConfig());
}

export function initTestOrm(): Promise<MikroORM> {
  return MikroORM.init(createOrmOptions(testDatabaseConfig()));
}
