import { GetTopicAttributesCommand, type SNSClient } from "@aws-sdk/client-sns";
import type { DependencyCheck } from "../../application/ports/dependency-check";

export class SnsTopicCheck implements DependencyCheck {
  readonly name = "sns";

  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async check(signal: AbortSignal): Promise<void> {
    await this.client.send(new GetTopicAttributesCommand({ TopicArn: this.topicArn }), { abortSignal: signal });
  }
}
