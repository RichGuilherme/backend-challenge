import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";
import type { OutboxMessage } from "../../application/messaging/outbox-message";
import { EventPublishFailedError, type EventPublisher } from "../../application/ports/event-publisher";

export class SnsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async publish(message: OutboxMessage): Promise<void> {
    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: JSON.stringify(message.payload),
          MessageGroupId: message.partitionKey,
          MessageDeduplicationId: message.id,
          MessageAttributes: { eventType: { DataType: "String", StringValue: message.eventType } },
        }),
      );
    } catch (error) {
      throw new EventPublishFailedError(message.id, error instanceof Error ? error.message : String(error));
    }
  }
}
