import { Global, Module } from "@nestjs/common";
import { Registry } from "prom-client";
import type { Logger } from "../application/ports/logger";
import type { Metrics } from "../application/ports/metrics";
import type { Observability } from "../application/ports/observability";
import { PinoLogger, createRootLogger } from "../infrastructure/observability/pino-logger";
import { PrometheusMetrics } from "../infrastructure/observability/prometheus-metrics";
import { loadLoggingConfig } from "../shared/config/env";
import { LOGGER, METRICS, METRICS_REGISTRY, OBSERVABILITY } from "./tokens";

@Global()
@Module({
  providers: [
    { provide: METRICS_REGISTRY, useFactory: () => new Registry() },
    {
      provide: METRICS,
      inject: [METRICS_REGISTRY],
      useFactory: (registry: Registry) => new PrometheusMetrics(registry),
    },
    { provide: LOGGER, useFactory: () => new PinoLogger(createRootLogger(loadLoggingConfig())) },
    {
      provide: OBSERVABILITY,
      inject: [METRICS, LOGGER],
      useFactory: (metrics: Metrics, logger: Logger): Observability => ({ metrics, logger }),
    },
  ],
  exports: [METRICS_REGISTRY, METRICS, LOGGER, OBSERVABILITY],
})
export class ObservabilityModule {}
