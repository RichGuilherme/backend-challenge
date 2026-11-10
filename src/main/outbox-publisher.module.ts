import { Module } from "@nestjs/common";
import { SNSClient } from "@aws-sdk/client-sns";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import { PublishOutboxBatchUseCase } from "../application/messaging/publish-outbox-batch.use-case";
import type { Clock } from "../application/ports/clock";
import type { EventPublisher } from "../application/ports/event-publisher";
import type { Logger } from "../application/ports/logger";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { createSnsClient } from "../infrastructure/messaging/aws-clients";
import { SnsEventPublisher } from "../infrastructure/messaging/sns-event-publisher";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { SnsTopicCheck } from "../infrastructure/observability/sns-topic-check";
import { loadAwsConfig, loadOutboxConfig } from "../shared/config/env";
import { InfrastructureModule } from "./infrastructure.module";
import { OutboxLagModule } from "./outbox-lag.module";
import { CLOCK, EVENT_PUBLISHER, LOGGER, METRICS_REGISTRY, UNIT_OF_WORK } from "./tokens";
import { WorkerHost } from "./worker-host";

@Module({
  imports: [InfrastructureModule, OutboxLagModule],
  providers: [
    { provide: SNSClient, useFactory: () => createSnsClient(loadAwsConfig()) },
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
      provide: WorkerHost,
      inject: [PublishOutboxBatchUseCase, SNSClient, MikroORM, METRICS_REGISTRY, LOGGER],
      useFactory: (
        publishBatch: PublishOutboxBatchUseCase,
        sns: SNSClient,
        orm: MikroORM,
        registry: Registry,
        logger: Logger,
      ) => {
        const { batchSize, pollIntervalMs, topicArn } = loadOutboxConfig();
        return new WorkerHost({
          name: "outbox-publisher",
          task: async () => (await publishBatch.execute(batchSize)).claimed >= batchSize,
          pollIntervalMs,
          checks: [new PostgresCheck(orm), new SnsTopicCheck(sns, topicArn)],
          registry,
          logger,
          release: () => sns.destroy(),
        });
      },
    },
  ],
})
export class OutboxPublisherModule {}
