export type PollingTask = () => Promise<boolean>;

export interface PollingWorkerOptions {
  pollIntervalMs: number;
}

export class PollingWorker {
  private running = false;
  private loop: Promise<void> | undefined;
  private wakeUp: (() => void) | undefined;

  constructor(
    private readonly task: PollingTask,
    private readonly options: PollingWorkerOptions,
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
      const hasMoreWork = await this.runTask();
      if (!hasMoreWork && this.running) await this.idle();
    }
  }

  private async runTask(): Promise<boolean> {
    try {
      return await this.task();
    } catch (error) {
      this.onError(error);
      return false;
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
