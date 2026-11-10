export const METRICS = Symbol("Metrics");

export type ProcessingSource = "http" | "sqs" | "reference-worker";

export type DeadLetterReason =
  | "INVALID_JSON"
  | "INVALID_PAYLOAD"
  | "WALLET_NOT_FOUND"
  | "WALLET_PLAYER_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "RETRIES_EXHAUSTED";

export interface Metrics {
  transactionSettled(kind: string, status: string): void;
  idempotentReplay(): void;
  messageRetry(): void;
  deadLettered(reason: DeadLetterReason): void;
  lockConflict(): void;
  processingDuration(source: ProcessingSource, seconds: number): void;
}

export const NO_METRICS: Metrics = {
  transactionSettled: () => undefined,
  idempotentReplay: () => undefined,
  messageRetry: () => undefined,
  deadLettered: () => undefined,
  lockConflict: () => undefined,
  processingDuration: () => undefined,
};
