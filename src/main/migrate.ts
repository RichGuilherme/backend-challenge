import { MikroORM } from "@mikro-orm/postgresql";
import { createOrmOptions } from "../infrastructure/persistence/orm.config";
import { loadDatabaseConfig } from "../shared/config/env";

const direction = process.argv[2] ?? "up";
if (direction !== "up" && direction !== "down") {
  throw new Error(`Direção inválida: ${direction} (use up ou down)`);
}

const orm = await MikroORM.init(createOrmOptions(loadDatabaseConfig()));
try {
  const executed = direction === "up" ? await orm.migrator.up() : await orm.migrator.down();
  console.log(
    JSON.stringify({
      direction,
      migrations: executed.map((migration) => migration.name),
    }),
  );
} finally {
  await orm.close(true);
}
