export interface OutboxLagQuery {
  oldestPendingAgeSeconds(): Promise<number>;
}
