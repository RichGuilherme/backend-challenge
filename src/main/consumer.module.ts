import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import { ConsumeWagerMessageUseCase } from "../application/messaging/consume-wager-message.use-case";
import type { Clock } from "../application/ports/clock";
import type { Logger } from "../application/ports/logger";
import type { Metrics } from "../application/ports/metrics";
import type { Observability } from "../application/ports/observability";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { SubmitWagerTransactionUseCase } from "../application/wagering/submit-wager-transaction.use-case";
import { SqsWagerMessageQueue } from "../infrastructure/messaging/sqs-wager-message-queue";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { SqsQueueCheck } from "../infrastructure/observability/sqs-queue-check";
import { WagerMessageConsumer } from "../presentation/messaging/wager-message.consumer";
import type { OpsServer } from "../presentation/ops/ops-server";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadAwsConfig, loadConsumerConfig, loadMaxReceives } from "../shared/config/env";
import { createOpsServer } from "./ops";
import {
  CLOCK,
  LOGGER,
  METRICS,
  METRICS_REGISTRY,
  OBSERVABILITY,
  OPS_SERVER,
  UNIT_OF_WORK,
  WAGER_CONSUMER_WORKER,
} from "./tokens";
import { UseCasesModule } from "./use-cases.module";
import { workerErrorLogger } from "./worker-error-logger";

const CONSUMER_IDLE_MS = 100;

@Module({
  imports: [UseCasesModule],
  providers: [
    {
      provide: SQSClient,
      useFactory: () => {
        const { region, endpoint } = loadAwsConfig();
        return new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
      },
    },
    {
      provide: SqsWagerMessageQueue,
      inject: [SQSClient],
      useFactory: async (client: SQSClient) => {
        const { queueName, deadLetterQueueName } = loadConsumerConfig();
        const urlOf = async (name: string) =>
          (await client.send(new GetQueueUrlCommand({ QueueName: name }))).QueueUrl!;
        return new SqsWagerMessageQueue(client, {
          queueUrl: await urlOf(queueName),
          deadLetterQueueUrl: await urlOf(deadLetterQueueName),
        });
      },
    },
    {
      provide: ConsumeWagerMessageUseCase,
      inject: [UNIT_OF_WORK, SubmitWagerTransactionUseCase, CLOCK, METRICS],
      useFactory: (unitOfWork: UnitOfWork, submit: SubmitWagerTransactionUseCase, clock: Clock, metrics: Metrics) =>
        new ConsumeWagerMessageUseCase(unitOfWork, submit, clock, metrics),
    },
    {
      provide: WagerMessageConsumer,
      inject: [SqsWagerMessageQueue, ConsumeWagerMessageUseCase, OBSERVABILITY],
      useFactory: (queue: SqsWagerMessageQueue, consume: ConsumeWagerMessageUseCase, observability: Observability) => {
        const { batchSize, waitSeconds, retry } = loadConsumerConfig();
        return new WagerMessageConsumer(
          queue,
          consume,
          { batchSize, waitSeconds, retry, maxReceives: loadMaxReceives() },
          observability,
        );
      },
    },
    {
      provide: WAGER_CONSUMER_WORKER,
      inject: [WagerMessageConsumer, LOGGER],
      useFactory: (consumer: WagerMessageConsumer, logger: Logger) =>
        new PollingWorker(
          () => consumer.pollOnce(),
          { pollIntervalMs: CONSUMER_IDLE_MS },
          workerErrorLogger(logger, "consumer"),
        ),
    },
    {
      provide: OPS_SERVER,
      inject: [METRICS_REGISTRY, MikroORM, SQSClient],
      useFactory: (registry: Registry, orm: MikroORM, sqs: SQSClient) =>
        createOpsServer(registry, [new PostgresCheck(orm), new SqsQueueCheck(sqs, loadConsumerConfig().queueName)]),
    },
  ],
})
export class ConsumerModule implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    @Inject(WagerMessageConsumer) private readonly consumer: WagerMessageConsumer,
    @Inject(WAGER_CONSUMER_WORKER) private readonly worker: PollingWorker,
    @Inject(OPS_SERVER) private readonly ops: OpsServer,
    @Inject(SQSClient) private readonly sqs: SQSClient,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ops.start();
    this.worker.start();
    this.logger.info("consumer iniciado", { opsPort: this.ops.port });
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.consumer.requestStop();
    await this.worker.stop();
    await this.ops.stop();
    this.logger.info("consumer encerrado");
  }

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}
