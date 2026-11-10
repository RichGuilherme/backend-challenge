import { Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { Observability } from "../application/ports/observability";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { ResolvePendingReferenceUseCase } from "../application/wagering/resolve-pending-reference.use-case";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { loadPendingReferenceConfig } from "../shared/config/env";
import { InfrastructureModule } from "./infrastructure.module";
import { CLOCK, ID_GENERATOR, LOGGER, METRICS_REGISTRY, OBSERVABILITY, UNIT_OF_WORK } from "./tokens";
import { WorkerHost } from "./worker-host";

@Module({
  imports: [InfrastructureModule],
  providers: [
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
      provide: WorkerHost,
      inject: [ResolvePendingReferenceUseCase, MikroORM, METRICS_REGISTRY, LOGGER],
      useFactory: (resolve: ResolvePendingReferenceUseCase, orm: MikroORM, registry: Registry, logger: Logger) =>
        new WorkerHost({
          name: "reference-worker",
          task: async () => (await resolve.execute()) !== undefined,
          pollIntervalMs: loadPendingReferenceConfig().pollIntervalMs,
          checks: [new PostgresCheck(orm)],
          registry,
          logger,
        }),
    },
  ],
})
export class ReferenceWorkerModule {}
