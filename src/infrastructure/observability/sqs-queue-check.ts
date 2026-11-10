import { GetQueueUrlCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { DependencyCheck } from "../../application/ports/dependency-check";

export class SqsQueueCheck implements DependencyCheck {
  readonly name = "sqs";

  constructor(
    private readonly client: SQSClient,
    private readonly queueName: string,
  ) {}

  async check(signal: AbortSignal): Promise<void> {
    await this.client.send(new GetQueueUrlCommand({ QueueName: this.queueName }), { abortSignal: signal });
  }
}
