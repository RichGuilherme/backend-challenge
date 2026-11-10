import { Counter, Histogram, type Registry } from "prom-client";
import type { DeadLetterReason, Metrics, ProcessingSource } from "../../application/ports/metrics";

export class PrometheusMetrics implements Metrics {
  private readonly transactions: Counter<"kind" | "status">;
  private readonly replays: Counter;
  private readonly retries: Counter;
  private readonly deadLetters: Counter<"reason">;
  private readonly lockConflicts: Counter;
  private readonly duration: Histogram<"source">;

  constructor(registry: Registry) {
    this.transactions = new Counter({
      name: "wagering_transactions_total",
      help: "Transações liquidadas, por kind e status",
      labelNames: ["kind", "status"],
      registers: [registry],
    });
    this.replays = new Counter({
      name: "wagering_idempotent_replays_total",
      help: "Submissões repetidas respondidas pelo resultado original",
      registers: [registry],
    });
    this.retries = new Counter({
      name: "wagering_message_retries_total",
      help: "Mensagens devolvidas à fila por erro transitório",
      registers: [registry],
    });
    this.deadLetters = new Counter({
      name: "wagering_dlq_messages_total",
      help: "Mensagens enviadas à DLQ, por motivo",
      labelNames: ["reason"],
      registers: [registry],
    });
    this.lockConflicts = new Counter({
      name: "wagering_lock_conflicts_total",
      help: "Operações abortadas por lock timeout ou deadlock",
      registers: [registry],
    });
    this.duration = new Histogram({
      name: "wagering_processing_duration_seconds",
      help: "Duração do processamento de uma transação, por origem",
      labelNames: ["source"],
      registers: [registry],
    });
  }

  transactionSettled(kind: string, status: string): void {
    this.transactions.inc({ kind, status });
  }

  idempotentReplay(): void {
    this.replays.inc();
  }

  messageRetry(): void {
    this.retries.inc();
  }

  deadLettered(reason: DeadLetterReason): void {
    this.deadLetters.inc({ reason });
  }

  lockConflict(): void {
    this.lockConflicts.inc();
  }

  processingDuration(source: ProcessingSource, seconds: number): void {
    this.duration.observe({ source }, seconds);
  }
}
