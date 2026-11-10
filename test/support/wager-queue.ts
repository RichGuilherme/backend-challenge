import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import type { SqsQueueUrls } from "../../src/infrastructure/messaging/sqs-wager-message-queue";
import { loadAwsConfig, requireEnv } from "../../src/shared/config/env";

export interface DeadLetter {
  body: string;
  failureReason: string | undefined;
}

export class WagerQueueHarness {
  private constructor(
    readonly client: SQSClient,
    readonly urls: SqsQueueUrls,
  ) {}

  static async connect(): Promise<WagerQueueHarness> {
    const { region, endpoint } = loadAwsConfig();

    const client = new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });

    const urlOf = async (name: string) =>
      (await client.send(new GetQueueUrlCommand({ QueueName: name })))
        .QueueUrl!;

    return new WagerQueueHarness(client, {
      queueUrl: await urlOf(requireEnv("SQS_QUEUE_NAME")),
      deadLetterQueueUrl: await urlOf(requireEnv("SQS_DLQ_NAME")),
    });
  }

  async purge(): Promise<void> {
    await this.client.send(
      new PurgeQueueCommand({ QueueUrl: this.urls.queueUrl }),
    );
    await this.client.send(
      new PurgeQueueCommand({ QueueUrl: this.urls.deadLetterQueueUrl }),
    );
  }

  async send(
    body: string,
    groupId: string,
    correlationId?: string,
  ): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.urls.queueUrl,
        MessageBody: body,
        MessageGroupId: groupId,
        MessageDeduplicationId: crypto.randomUUID(),
        ...(correlationId
          ? {
              MessageAttributes: {
                correlationId: {
                  DataType: "String",
                  StringValue: correlationId,
                },
              },
            }
          : {}),
      }),
    );
  }

  async takeDeadLetters(timeoutMs = 3_000): Promise<DeadLetter[]> {
    const letters: DeadLetter[] = [];
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const { Messages = [] } = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.urls.deadLetterQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          MessageAttributeNames: ["All"],
        }),
      );

      for (const message of Messages) {
        letters.push({
          body: message.Body ?? "",
          failureReason: message.MessageAttributes?.failureReason?.StringValue,
        });
        await this.client.send(
          new DeleteMessageCommand({
            QueueUrl: this.urls.deadLetterQueueUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }),
        );
      }
      if (letters.length > 0 && Messages.length === 0) break;
    }
    return letters;
  }

  async messagesInQueue(): Promise<{ visible: number; inFlight: number }> {
    const { Attributes = {} } = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.urls.queueUrl,
        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
        ],
      }),
    );

    return {
      visible: Number.parseInt(
        Attributes.ApproximateNumberOfMessages ?? "0",
        10,
      ),
      inFlight: Number.parseInt(
        Attributes.ApproximateNumberOfMessagesNotVisible ?? "0",
        10,
      ),
    };
  }

  close(): void {
    this.client.destroy();
  }
}

export function wagerEnvelope(
  messageId: string,
  data: Record<string, unknown>,
): string {
  return JSON.stringify({
    messageId,
    type: "WagerTransactionRequested",
    occurredAt: "2026-11-10T12:00:00.000Z",
    data,
  });
}
