import type { Logger } from "../application/ports/logger";

export function workerErrorLogger(logger: Logger, worker: string): (error: unknown) => void {
  return (error) => logger.error("falha no ciclo do worker", { worker, error: String(error) });
}
