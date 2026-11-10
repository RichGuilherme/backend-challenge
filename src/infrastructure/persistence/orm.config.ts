import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";
import { migrations } from "../../../migrations";
import { persistenceRecords } from "./records";
import type { DatabaseConfig } from "../../shared/config/env";

export function createOrmOptions(database: DatabaseConfig): Options {
  return defineConfig({
    host: database.host,
    port: database.port,
    dbName: database.name,
    user: database.user,
    password: database.password,
    entities: persistenceRecords,
    extensions: [Migrator],
    migrations: {
      tableName: "mikro_orm_migrations",
      snapshot: false,
      migrationsList: migrations,
    },
  });
}
