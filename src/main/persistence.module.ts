import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Metrics } from "../application/ports/metrics";
import { createOrmOptions } from "../infrastructure/persistence/orm.config";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgres-unit-of-work";
import { loadDatabaseConfig, loadLockTimeoutMs } from "../shared/config/env";
import { ObservabilityModule } from "./observability.module";
import { METRICS, UNIT_OF_WORK } from "./tokens";

@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      provide: MikroORM,
      useFactory: () => MikroORM.init(createOrmOptions(loadDatabaseConfig())),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [MikroORM, METRICS],
      useFactory: (orm: MikroORM, metrics: Metrics) => new PostgresUnitOfWork(orm, loadLockTimeoutMs(), metrics),
    },
  ],
  exports: [MikroORM, UNIT_OF_WORK],
})
export class PersistenceModule implements OnApplicationShutdown {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    await this.orm.close(true);
  }
}
