import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SNSClient } from "@aws-sdk/client-sns";
import { PublishOutboxBatchUseCase } from "../application/messaging/publish-outbox-batch.use-case";
import type { Clock } from "../application/ports/clock";
import type { EventPublisher } from "../application/ports/event-publisher";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { SnsEventPublisher } from "../infrastructure/messaging/sns-event-publisher";
import { SystemClock } from "../infrastructure/system/system-clock";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadAwsConfig, loadOutboxConfig } from "../shared/config/env";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, EVENT_PUBLISHER, OUTBOX_PUBLISHER_WORKER, UNIT_OF_WORK } from "./tokens";
import { workerErrorLogger } from "./worker-error-logger";

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: SNSClient,
      useFactory: () => {
        const { region, endpoint } = loadAwsConfig();
        return new SNSClient({ region, ...(endpoint ? { endpoint } : {}) });
      },
    },
    {
      provide: EVENT_PUBLISHER,
      inject: [SNSClient],
      useFactory: (client: SNSClient) => new SnsEventPublisher(client, loadOutboxConfig().topicArn),
    },
    {
      provide: PublishOutboxBatchUseCase,
      inject: [UNIT_OF_WORK, EVENT_PUBLISHER, CLOCK],
      useFactory: (unitOfWork: UnitOfWork, publisher: EventPublisher, clock: Clock) =>
        new PublishOutboxBatchUseCase(unitOfWork, publisher, clock, loadOutboxConfig().retry),
    },
    {
      provide: OUTBOX_PUBLISHER_WORKER,
      inject: [PublishOutboxBatchUseCase],
      useFactory: (publishBatch: PublishOutboxBatchUseCase) => {
        const { batchSize, pollIntervalMs } = loadOutboxConfig();
        return new PollingWorker(
          async () => (await publishBatch.execute(batchSize)).claimed >= batchSize,
          { pollIntervalMs },
          workerErrorLogger("outbox-publisher"),
        );
      },
    },
  ],
})
export class OutboxPublisherModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    @Inject(OUTBOX_PUBLISHER_WORKER) private readonly worker: PollingWorker,
    @Inject(SNSClient) private readonly sns: SNSClient,
  ) {}

  onApplicationBootstrap(): void {
    this.worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.stop();
  }

  onApplicationShutdown(): void {
    this.sns.destroy();
  }
}
