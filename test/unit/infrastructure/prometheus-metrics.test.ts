import { describe, expect, test } from "bun:test";
import { Registry } from "prom-client";
import { PrometheusMetrics } from "../../../src/infrastructure/observability/prometheus-metrics";
import { sampleOf } from "../../support/metrics";

function build() {
  const registry = new Registry();
  return { registry, metrics: new PrometheusMetrics(registry) };
}

describe("PrometheusMetrics", () => {
  test("transações por kind e status", async () => {
    const { registry, metrics } = build();
    metrics.transactionSettled("BET", "PROCESSED");
    metrics.transactionSettled("BET", "PROCESSED");
    metrics.transactionSettled("BET", "REJECTED");

    expect(await sampleOf(registry, "wagering_transactions_total", { kind: "BET", status: "PROCESSED" })).toBe(2);
    expect(await sampleOf(registry, "wagering_transactions_total", { kind: "BET", status: "REJECTED" })).toBe(1);
    expect(
      await sampleOf(registry, "wagering_transactions_total", { kind: "WIN", status: "PROCESSED" }),
    ).toBeUndefined();
  });

  test("duplicatas, retries e conflitos de lock são contadores simples", async () => {
    const { registry, metrics } = build();
    metrics.idempotentReplay();
    metrics.messageRetry();
    metrics.messageRetry();
    metrics.lockConflict();

    expect(await sampleOf(registry, "wagering_idempotent_replays_total")).toBe(1);
    expect(await sampleOf(registry, "wagering_message_retries_total")).toBe(2);
    expect(await sampleOf(registry, "wagering_lock_conflicts_total")).toBe(1);
  });

  test("mensagens na DLQ por motivo fixo", async () => {
    const { registry, metrics } = build();
    metrics.deadLettered("INVALID_JSON");
    metrics.deadLettered("INVALID_JSON");
    metrics.deadLettered("RETRIES_EXHAUSTED");

    expect(await sampleOf(registry, "wagering_dlq_messages_total", { reason: "INVALID_JSON" })).toBe(2);
    expect(await sampleOf(registry, "wagering_dlq_messages_total", { reason: "RETRIES_EXHAUSTED" })).toBe(1);
  });

  test("latência de processamento em histograma por origem", async () => {
    const { registry, metrics } = build();
    metrics.processingDuration("http", 0.02);
    metrics.processingDuration("http", 0.04);
    metrics.processingDuration("sqs", 1.5);

    expect(await sampleOf(registry, "wagering_processing_duration_seconds_count", { source: "http" })).toBe(2);
    expect(await sampleOf(registry, "wagering_processing_duration_seconds_sum", { source: "http" })).toBeCloseTo(0.06);
    expect(await sampleOf(registry, "wagering_processing_duration_seconds_count", { source: "sqs" })).toBe(1);
  });

  test("duas instâncias no mesmo registry são erro de programação", () => {
    const registry = new Registry();
    new PrometheusMetrics(registry);
    expect(() => new PrometheusMetrics(registry)).toThrow();
  });
});
