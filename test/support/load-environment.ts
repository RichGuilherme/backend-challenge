import { createTestContext, type TestContext } from "./application";
import { EventSubscriberQueue } from "./event-subscriber";
import { shortenVisibilityTimeout } from "./queue-visibility";
import { WagerQueueHarness } from "./wager-queue";

const QUEUE_VISIBILITY_SECONDS = 5;

export class LoadEnvironment {
  private constructor(
    readonly context: TestContext,
    readonly harness: WagerQueueHarness,
    readonly subscriber: EventSubscriberQueue,
    private readonly restoreVisibility: () => Promise<void>,
  ) {}

  static async create(): Promise<LoadEnvironment> {
    const context = await createTestContext({ lockTimeoutMs: 10_000 });
    const harness = await WagerQueueHarness.connect();
    const subscriber = await EventSubscriberQueue.connect();
    await harness.purge();
    await subscriber.purge();
    const restoreVisibility = await shortenVisibilityTimeout(harness, QUEUE_VISIBILITY_SECONDS);
    return new LoadEnvironment(context, harness, subscriber, restoreVisibility);
  }

  async close(): Promise<void> {
    await this.restoreVisibility();
    this.subscriber.close();
    this.harness.close();
    await this.context.close();
  }
}
