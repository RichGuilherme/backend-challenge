import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import { Registry } from "prom-client";
import type { Logger } from "../application/ports/logger";
import type { Metrics } from "../application/ports/metrics";
import type { Observability } from "../application/ports/observability";
import { PinoLogger, createRootLogger } from "../infrastructure/observability/pino-logger";
import { PrometheusMetrics } from "../infrastructure/observability/prometheus-metrics";
import { createOrmOptions } from "../infrastructure/persistence/orm.config";
import { PostgresUnitOfWork } from "../infrastructure/persistence/postgres-unit-of-work";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/system/uuid-v7-id-generator";
import { loadDatabaseConfig, loadLockTimeoutMs, loadLoggingConfig } from "../shared/config/env";
import { CLOCK, ID_GENERATOR, LOGGER, METRICS, METRICS_REGISTRY, OBSERVABILITY, UNIT_OF_WORK } from "./tokens";

@Global()
@Module({
  providers: [
    { provide: METRICS_REGISTRY, useFactory: () => new Registry() },
    {
      provide: METRICS,
      inject: [METRICS_REGISTRY],
      useFactory: (registry: Registry) => new PrometheusMetrics(registry),
    },
    { provide: LOGGER, useFactory: () => new PinoLogger(createRootLogger(loadLoggingConfig())) },
    {
      provide: OBSERVABILITY,
      inject: [METRICS, LOGGER],
      useFactory: (metrics: Metrics, logger: Logger): Observability => ({ metrics, logger }),
    },
    { provide: MikroORM, useFactory: () => MikroORM.init(createOrmOptions(loadDatabaseConfig())) },
    {
      provide: UNIT_OF_WORK,
      inject: [MikroORM, METRICS],
      useFactory: (orm: MikroORM, metrics: Metrics) => new PostgresUnitOfWork(orm, loadLockTimeoutMs(), metrics),
    },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
  ],
  exports: [METRICS_REGISTRY, METRICS, LOGGER, OBSERVABILITY, MikroORM, UNIT_OF_WORK, CLOCK, ID_GENERATOR],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

  async onApplicationShutdown(): Promise<void> {
    await this.orm.close(true);
  }
}
