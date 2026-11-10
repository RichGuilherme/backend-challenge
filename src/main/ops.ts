import type { Registry } from "prom-client";
import { ReadinessProbe } from "../application/observability/readiness-probe";
import type { DependencyCheck } from "../application/ports/dependency-check";
import { OpsEndpoints } from "../presentation/ops/ops-endpoints";
import { OpsServer } from "../presentation/ops/ops-server";
import { loadHealthTimeoutMs, loadOpsPort } from "../shared/config/env";

export function createOpsEndpoints(registry: Registry, checks: DependencyCheck[]): OpsEndpoints {
  return new OpsEndpoints(new ReadinessProbe(checks, loadHealthTimeoutMs()), registry);
}

export function createOpsServer(registry: Registry, checks: DependencyCheck[]): OpsServer {
  return new OpsServer(createOpsEndpoints(registry, checks), loadOpsPort());
}
