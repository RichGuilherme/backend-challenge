import { Inject, Module, type BeforeApplicationShutdown, type OnApplicationBootstrap } from "@nestjs/common";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { ResolvePendingReferenceUseCase } from "../application/wagering/resolve-pending-reference.use-case";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/system/uuid-v7-id-generator";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadPendingReferenceConfig } from "../shared/config/env";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, ID_GENERATOR, REFERENCE_WORKER, UNIT_OF_WORK } from "./tokens";
import { workerErrorLogger } from "./worker-error-logger";

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
    {
      provide: ResolvePendingReferenceUseCase,
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK],
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new ResolvePendingReferenceUseCase(unitOfWork, ids, clock, loadPendingReferenceConfig().policy),
    },
    {
      provide: REFERENCE_WORKER,
      inject: [ResolvePendingReferenceUseCase],
      useFactory: (resolve: ResolvePendingReferenceUseCase) =>
        new PollingWorker(
          async () => (await resolve.execute()) !== undefined,
          { pollIntervalMs: loadPendingReferenceConfig().pollIntervalMs },
          workerErrorLogger("reference-worker"),
        ),
    },
  ],
})
export class ReferenceWorkerModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(@Inject(REFERENCE_WORKER) private readonly worker: PollingWorker) {}

  onApplicationBootstrap(): void {
    this.worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.stop();
  }
}
