import { SQL } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";
import { createMikroOrmOptions } from "../../src/infrastructure/persistence/mikro-orm.config";
import {
  loadDatabaseConfig,
  type DatabaseConfig,
} from "../../src/shared/config/env";

export function testDatabaseConfig(): DatabaseConfig {
  const config = loadDatabaseConfig();
  return { ...config, name: `${config.name}_test` };
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
  return MikroORM.init(createMikroOrmOptions(testDatabaseConfig()));
}
