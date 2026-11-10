import type { Registry } from "prom-client";
import type { DependencyCheck } from "../application/ports/dependency-check";
import type { Logger } from "../application/ports/logger";
import type { OpsServer } from "../presentation/ops/ops-server";
import { PollingWorker, type PollingTask } from "../presentation/workers/polling-worker";
import { createOpsServer } from "./ops";

export interface WorkerHostOptions {
  name: string;
  task: PollingTask;
  pollIntervalMs: number;
  checks: DependencyCheck[];
  registry: Registry;
  logger: Logger;
  requestStop?: () => void;
  release?: () => void;
}

export class WorkerHost {
  private readonly worker: PollingWorker;
  private readonly ops: OpsServer;

  constructor(private readonly options: WorkerHostOptions) {
    const { name, task, pollIntervalMs, checks, registry, logger } = options;
    this.worker = new PollingWorker(task, { pollIntervalMs }, (error) =>
      logger.error("falha no ciclo do worker", { worker: name, error: String(error) }),
    );
    this.ops = createOpsServer(registry, checks);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ops.start();
    this.worker.start();
    this.options.logger.info(`${this.options.name} iniciado`, { opsPort: this.ops.port });
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.options.requestStop?.();
    await this.worker.stop();
    await this.ops.stop();
    this.options.logger.info(`${this.options.name} encerrado`);
  }

  onApplicationShutdown(): void {
    this.options.release?.();
  }
}
