import type { PublishOutboxBatchUseCase } from "../../application/messaging/publish-outbox-batch.use-case";

export interface OutboxPublisherWorkerOptions {
  batchSize: number;
  pollIntervalMs: number;
}

export class OutboxPublisherWorker {
  private running = false;
  private loop: Promise<void> | undefined;
  private wakeUp: (() => void) | undefined;

  constructor(
    private readonly publishBatch: PublishOutboxBatchUseCase,
    private readonly options: OutboxPublisherWorkerOptions,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wakeUp?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      const claimed = await this.publishOnce();
      if (claimed < this.options.batchSize) await this.idle();
    }
  }

  private async publishOnce(): Promise<number> {
    try {
      return (await this.publishBatch.execute(this.options.batchSize)).claimed;
    } catch (error) {
      this.onError(error);
      return 0;
    }
  }

  private idle(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, this.options.pollIntervalMs);
      this.wakeUp = done;
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
