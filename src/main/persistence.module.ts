import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Metrics } from "../application/ports/metrics";
import { createMikroOrmOptions } from "../infrastructure/persistence/mikro-orm.config";
import { MikroOrmUnitOfWork } from "../infrastructure/persistence/mikro-orm-unit-of-work";
import { loadDatabaseConfig, loadLockTimeoutMs } from "../shared/config/env";
import { ObservabilityModule } from "./observability.module";
import { METRICS, UNIT_OF_WORK } from "./tokens";

@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      provide: MikroORM,
      useFactory: () => MikroORM.init(createMikroOrmOptions(loadDatabaseConfig())),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [MikroORM, METRICS],
      useFactory: (orm: MikroORM, metrics: Metrics) => new MikroOrmUnitOfWork(orm, loadLockTimeoutMs(), metrics),
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
