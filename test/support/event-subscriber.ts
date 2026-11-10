import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { loadAwsConfig, requireEnv } from "../../src/shared/config/env";

export interface ReceivedEvent {
  eventId: string;
  eventType: string;
  body: Record<string, unknown>;
  groupId: string | undefined;
}

export class EventSubscriberQueue {
  private constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  static async connect(): Promise<EventSubscriberQueue> {
    const { region, endpoint } = loadAwsConfig();
    const client = new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
    const { QueueUrl } = await client.send(
      new GetQueueUrlCommand({ QueueName: requireEnv("SQS_EVENTS_SUBSCRIBER_QUEUE_NAME") }),
    );
    return new EventSubscriberQueue(client, QueueUrl!);
  }

  async purge(): Promise<void> {
    await this.client.send(new PurgeQueueCommand({ QueueUrl: this.queueUrl }));
  }

  async collect(expectedEventIds: readonly string[], timeoutMs = 10_000): Promise<ReceivedEvent[]> {
    const wanted = new Set(expectedEventIds);
    const received: ReceivedEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    let quietRounds = 0;
    while (Date.now() < deadline && quietRounds < 2) {
      const { Messages = [] } = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          MessageSystemAttributeNames: ["MessageGroupId"],
        }),
      );
      for (const message of Messages) {
        await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle! }));
        const body = JSON.parse(message.Body ?? "{}") as Record<string, unknown>;
        const eventId = String(body.eventId);
        if (!wanted.has(eventId)) continue;
        received.push({
          eventId,
          eventType: String(body.eventType),
          body,
          groupId: message.Attributes?.MessageGroupId,
        });
      }
      const allArrived = [...wanted].every((id) => received.some((event) => event.eventId === id));
      quietRounds = allArrived && Messages.length === 0 ? quietRounds + 1 : 0;
    }
    return received;
  }

  close(): void {
    this.client.destroy();
  }
}
