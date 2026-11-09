import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, type Options } from "@mikro-orm/postgresql";
import { migrations } from "../../../migrations";
import type { DatabaseConfig } from "../../shared/config/env";

export function createMikroOrmOptions(database: DatabaseConfig): Options {
  return defineConfig({
    host: database.host,
    port: database.port,
    dbName: database.name,
    user: database.user,
    password: database.password,
    entities: [],
    discovery: { warnWhenNoEntities: false },
    extensions: [Migrator],
    migrations: {
      tableName: "mikro_orm_migrations",
      snapshot: false,
      migrationsList: migrations,
    },
  });
}
