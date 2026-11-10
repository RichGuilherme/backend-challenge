import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { QueueMessage, WagerMessageQueue } from "../../application/ports/wager-message-queue";

const MAX_VISIBILITY_TIMEOUT_SECONDS = 43_200;
const MAX_ATTRIBUTE_LENGTH = 256;
const UNPARSEABLE_GROUP_ID = "unparseable";

export interface SqsQueueUrls {
  queueUrl: string;
  deadLetterQueueUrl: string;
}

export class SqsWagerMessageQueue implements WagerMessageQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly urls: SqsQueueUrls,
  ) {}

  async receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]> {
    const { Messages = [] } = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.urls.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitSeconds,
        MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
        MessageAttributeNames: ["correlationId"],
      }),
    );
    return Messages.map(toQueueMessage);
  }

  async acknowledge(message: QueueMessage): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.urls.queueUrl, ReceiptHandle: message.receiptHandle }));
  }

  async retryLater(message: QueueMessage, delayMs: number): Promise<void> {
    await this.changeVisibility(message, Math.min(MAX_VISIBILITY_TIMEOUT_SECONDS, Math.ceil(delayMs / 1_000)));
  }

  async release(message: QueueMessage): Promise<void> {
    await this.changeVisibility(message, 0);
  }

  async deadLetter(message: QueueMessage, reason: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.urls.deadLetterQueueUrl,
        MessageBody: message.body,
        MessageGroupId: message.groupId ?? UNPARSEABLE_GROUP_ID,
        MessageDeduplicationId: message.queueMessageId,
        MessageAttributes: {
          failureReason: { DataType: "String", StringValue: reason.slice(0, MAX_ATTRIBUTE_LENGTH) || "desconhecido" },
          originalMessageId: { DataType: "String", StringValue: message.queueMessageId },
        },
      }),
    );
    await this.acknowledge(message);
  }

  private async changeVisibility(message: QueueMessage, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.urls.queueUrl,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }
}

function toQueueMessage(message: Message): QueueMessage {
  return {
    body: message.Body ?? "",
    receiptHandle: message.ReceiptHandle ?? "",
    queueMessageId: message.MessageId ?? "",
    receiveCount: Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? "1", 10),
    groupId: message.Attributes?.MessageGroupId,
    correlationId: message.MessageAttributes?.correlationId?.StringValue,
  };
}
