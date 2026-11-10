import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConsumeWagerMessageUseCase } from "../application/messaging/consume-wager-message.use-case";
import type { Clock } from "../application/ports/clock";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { SubmitWagerTransactionUseCase } from "../application/wagering/submit-wager-transaction.use-case";
import { SqsWagerMessageQueue } from "../infrastructure/messaging/sqs-wager-message-queue";
import { WagerMessageConsumer } from "../presentation/messaging/wager-message.consumer";
import { PollingWorker } from "../presentation/workers/polling-worker";
import { loadAwsConfig, loadConsumerConfig } from "../shared/config/env";
import { CLOCK, UNIT_OF_WORK, WAGER_CONSUMER_WORKER } from "./tokens";
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
          (await client.send(new GetQueueUrlCommand({ QueueName: name })))
            .QueueUrl!;
        return new SqsWagerMessageQueue(client, {
          queueUrl: await urlOf(queueName),
          deadLetterQueueUrl: await urlOf(deadLetterQueueName),
        });
      },
    },
    {
      provide: ConsumeWagerMessageUseCase,
      inject: [UNIT_OF_WORK, SubmitWagerTransactionUseCase, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        submit: SubmitWagerTransactionUseCase,
        clock: Clock,
      ) => new ConsumeWagerMessageUseCase(unitOfWork, submit, clock),
    },
    {
      provide: WagerMessageConsumer,
      inject: [SqsWagerMessageQueue, ConsumeWagerMessageUseCase],
      useFactory: (
        queue: SqsWagerMessageQueue,
        consume: ConsumeWagerMessageUseCase,
      ) => {
        const { batchSize, waitSeconds, retry } = loadConsumerConfig();
        return new WagerMessageConsumer(
          queue,
          consume,
          { batchSize, waitSeconds, retry },
          {
            warn: (event, fields) =>
              console.warn(
                JSON.stringify({
                  level: "warn",
                  worker: "consumer",
                  msg: event,
                  ...fields,
                }),
              ),
          },
        );
      },
    },
    {
      provide: WAGER_CONSUMER_WORKER,
      inject: [WagerMessageConsumer],
      useFactory: (consumer: WagerMessageConsumer) =>
        new PollingWorker(
          () => consumer.pollOnce(),
          { pollIntervalMs: CONSUMER_IDLE_MS },
          workerErrorLogger("consumer"),
        ),
    },
  ],
})
export class ConsumerModule
  implements
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  constructor(
    @Inject(WagerMessageConsumer)
    private readonly consumer: WagerMessageConsumer,
    @Inject(WAGER_CONSUMER_WORKER) private readonly worker: PollingWorker,
    @Inject(SQSClient) private readonly sqs: SQSClient,
  ) {}

  onApplicationBootstrap(): void {
    this.worker.start();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.consumer.requestStop();
    await this.worker.stop();
  }

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}
