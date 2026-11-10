import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { SNSClient } from "@aws-sdk/client-sns";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import { PublishOutboxBatchUseCase } from "../application/messaging/publish-outbox-batch.use-case";
import type { Clock } from "../application/ports/clock";
import type { EventPublisher } from "../application/ports/event-publisher";
import type { Logger } from "../application/ports/logger";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { SnsEventPublisher } from "../infrastructure/messaging/sns-event-publisher";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { SnsTopicCheck } from "../infrastructure/observability/sns-topic-check";
import { SystemClock } from "../infrastructure/system/system-clock";
import type { OpsServer } from "../presentation/ops/ops-server";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadAwsConfig, loadOutboxConfig } from "../shared/config/env";
import { createOpsServer } from "./ops";
import { OutboxLagModule } from "./outbox-lag.module";
import { PersistenceModule } from "./persistence.module";
import {
  CLOCK,
  EVENT_PUBLISHER,
  LOGGER,
  METRICS_REGISTRY,
  OPS_SERVER,
  OUTBOX_PUBLISHER_WORKER,
  UNIT_OF_WORK,
} from "./tokens";
import { workerErrorLogger } from "./worker-error-logger";

@Module({
  imports: [PersistenceModule, OutboxLagModule],
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
      inject: [PublishOutboxBatchUseCase, LOGGER],
      useFactory: (publishBatch: PublishOutboxBatchUseCase, logger: Logger) => {
        const { batchSize, pollIntervalMs } = loadOutboxConfig();
        return new PollingWorker(
          async () => (await publishBatch.execute(batchSize)).claimed >= batchSize,
          { pollIntervalMs },
          workerErrorLogger(logger, "outbox-publisher"),
        );
      },
    },
    {
      provide: OPS_SERVER,
      inject: [METRICS_REGISTRY, MikroORM, SNSClient],
      useFactory: (registry: Registry, orm: MikroORM, sns: SNSClient) =>
        createOpsServer(registry, [new PostgresCheck(orm), new SnsTopicCheck(sns, loadOutboxConfig().topicArn)]),
    },
  ],
})
export class OutboxPublisherModule implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    @Inject(OUTBOX_PUBLISHER_WORKER) private readonly worker: PollingWorker,
    @Inject(OPS_SERVER) private readonly ops: OpsServer,
    @Inject(SNSClient) private readonly sns: SNSClient,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ops.start();
    this.worker.start();
    this.logger.info("outbox-publisher iniciado", { opsPort: this.ops.port });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker.stop();
    await this.ops.stop();
    this.logger.info("outbox-publisher encerrado");
  }

  onApplicationShutdown(): void {
    this.sns.destroy();
  }
}
