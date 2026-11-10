import { Inject, Module, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { Observability } from "../application/ports/observability";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { ResolvePendingReferenceUseCase } from "../application/wagering/resolve-pending-reference.use-case";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/system/uuid-v7-id-generator";
import type { OpsServer } from "../presentation/ops/ops-server";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadPendingReferenceConfig } from "../shared/config/env";
import { createOpsServer } from "./ops";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, ID_GENERATOR, LOGGER, METRICS_REGISTRY, OBSERVABILITY, OPS_SERVER, REFERENCE_WORKER, UNIT_OF_WORK } from "./tokens";
import { workerErrorLogger } from "./worker-error-logger";

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
    {
      provide: ResolvePendingReferenceUseCase,
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK, OBSERVABILITY],
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock, observability: Observability) =>
        new ResolvePendingReferenceUseCase(
          unitOfWork,
          ids,
          clock,
          loadPendingReferenceConfig().policy,
          Math.random,
          observability,
        ),
    },
    {
      provide: REFERENCE_WORKER,
      inject: [ResolvePendingReferenceUseCase, LOGGER],
      useFactory: (resolve: ResolvePendingReferenceUseCase, logger: Logger) =>
        new PollingWorker(
          async () => (await resolve.execute()) !== undefined,
          { pollIntervalMs: loadPendingReferenceConfig().pollIntervalMs },
          workerErrorLogger(logger, "reference-worker"),
        ),
    },
    {
      provide: OPS_SERVER,
      inject: [METRICS_REGISTRY, MikroORM],
      useFactory: (registry: Registry, orm: MikroORM) => createOpsServer(registry, [new PostgresCheck(orm)]),
    },
  ],
})
export class ReferenceWorkerModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    @Inject(REFERENCE_WORKER) private readonly worker: PollingWorker,
    @Inject(OPS_SERVER) private readonly ops: OpsServer,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ops.start();
    this.worker.start();
    this.logger.info("reference-worker iniciado", { opsPort: this.ops.port });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.stop();
    await this.ops.stop();
    this.logger.info("reference-worker encerrado");
  }
}
