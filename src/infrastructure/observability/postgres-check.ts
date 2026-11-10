import type { MikroORM } from "@mikro-orm/postgresql";
import type { DependencyCheck } from "../../application/ports/dependency-check";

export class PostgresCheck implements DependencyCheck {
  readonly name = "postgres";

  constructor(private readonly orm: MikroORM) {}

  async check(_signal: AbortSignal): Promise<void> {
    await this.orm.em.getConnection().execute("select 1");
  }
}
