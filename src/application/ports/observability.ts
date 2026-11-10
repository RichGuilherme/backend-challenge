import { NO_LOGGER, type Logger } from "./logger";
import { NO_METRICS, type Metrics } from "./metrics";

export interface Observability {
  metrics: Metrics;
  logger: Logger;
}

export const NO_OBSERVABILITY: Observability = { metrics: NO_METRICS, logger: NO_LOGGER };
