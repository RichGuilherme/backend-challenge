import type { Clock } from "../ports/clock";
import { EventPublishFailedError, type EventPublisher } from "../ports/event-publisher";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { BackoffPolicy, RandomSource } from "./full-jitter";
import type { OutboxMessage } from "./outbox-message";

export interface PublishBatchResult {
  claimed: number;
  published: number;
  retried: number;
  deferred: number;
}

export class PublishOutboxBatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly publisher: EventPublisher,
    private readonly clock: Clock,
    private readonly retryPolicy: BackoffPolicy,
    private readonly random: RandomSource = Math.random,
  ) {}

  execute(batchSize: number): Promise<PublishBatchResult> {
    return this.unitOfWork.run(async ({ outbox }) => {
      const messages = await outbox.claimDue(this.clock.now(), batchSize);
      const blockedPartitions = new Set<string>();
      const result: PublishBatchResult = { claimed: messages.length, published: 0, retried: 0, deferred: 0 };

      for (const message of messages) {
        if (blockedPartitions.has(message.partitionKey)) {
          result.deferred += 1;
          continue;
        }
        if (await this.tryPublish(message)) {
          result.published += 1;
        } else {
          blockedPartitions.add(message.partitionKey);
          result.retried += 1;
        }
        await outbox.save(message);
      }
      return result;
    });
  }

  private async tryPublish(message: OutboxMessage): Promise<boolean> {
    try {
      await this.publisher.publish(message);
    } catch (error) {
      if (!(error instanceof EventPublishFailedError)) throw error;
      message.scheduleRetry(this.clock.now(), this.retryPolicy, this.random);
      return false;
    }
    message.markPublished(this.clock.now());
    return true;
  }
}
