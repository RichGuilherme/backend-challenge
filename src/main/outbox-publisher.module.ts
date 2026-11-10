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
import { OutboxPublisherWorker } from "../presentation/workers/outbox-publisher.worker";
import { loadAwsConfig, loadOutboxConfig } from "../shared/config/env";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, EVENT_PUBLISHER, UNIT_OF_WORK } from "./tokens";

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
      provide: OutboxPublisherWorker,
      inject: [PublishOutboxBatchUseCase],
      useFactory: (publishBatch: PublishOutboxBatchUseCase) => {
        const { batchSize, pollIntervalMs } = loadOutboxConfig();
        return new OutboxPublisherWorker(publishBatch, { batchSize, pollIntervalMs }, (error) =>
          console.error(JSON.stringify({ level: "error", msg: "falha no lote da outbox", error: String(error) })),
        );
      },
    },
  ],
  exports: [OutboxPublisherWorker],
})
export class OutboxPublisherModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    @Inject(OutboxPublisherWorker) private readonly worker: OutboxPublisherWorker,
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
