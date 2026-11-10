import { Module } from "@nestjs/common";
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
import { createSqsClient } from "../infrastructure/messaging/aws-clients";
import { SqsWagerMessageQueue } from "../infrastructure/messaging/sqs-wager-message-queue";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { SqsQueueCheck } from "../infrastructure/observability/sqs-queue-check";
import { WagerMessageConsumer } from "../presentation/messaging/wager-message.consumer";
import { loadAwsConfig, loadConsumerConfig, loadMaxReceives } from "../shared/config/env";
import { InfrastructureModule } from "./infrastructure.module";
import { CLOCK, LOGGER, METRICS, METRICS_REGISTRY, OBSERVABILITY, UNIT_OF_WORK } from "./tokens";
import { UseCasesModule } from "./use-cases.module";
import { WorkerHost } from "./worker-host";

const CONSUMER_IDLE_MS = 100;

@Module({
  imports: [InfrastructureModule, UseCasesModule],
  providers: [
    { provide: SQSClient, useFactory: () => createSqsClient(loadAwsConfig()) },
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
      provide: WorkerHost,
      inject: [WagerMessageConsumer, SQSClient, MikroORM, METRICS_REGISTRY, LOGGER],
      useFactory: (consumer: WagerMessageConsumer, sqs: SQSClient, orm: MikroORM, registry: Registry, logger: Logger) =>
        new WorkerHost({
          name: "consumer",
          task: () => consumer.pollOnce(),
          pollIntervalMs: CONSUMER_IDLE_MS,
          checks: [new PostgresCheck(orm), new SqsQueueCheck(sqs, loadConsumerConfig().queueName)],
          registry,
          logger,
          requestStop: () => consumer.requestStop(),
          release: () => sqs.destroy(),
        }),
    },
  ],
})
export class ConsumerModule {}
