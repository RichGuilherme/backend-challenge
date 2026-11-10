import type { Registry } from "prom-client";
import type { ReadinessProbe } from "../../application/observability/readiness-probe";

export interface OpsResponse {
  status: number;
  contentType: string;
  body: unknown;
}

const JSON_CONTENT_TYPE = "application/json";

export class OpsEndpoints {
  constructor(
    private readonly readiness: ReadinessProbe,
    private readonly registry: Registry,
  ) {}

  async live(): Promise<OpsResponse> {
    return { status: 200, contentType: JSON_CONTENT_TYPE, body: { status: "ok" } };
  }

  async ready(): Promise<OpsResponse> {
    const report = await this.readiness.check();
    return { status: report.ready ? 200 : 503, contentType: JSON_CONTENT_TYPE, body: report };
  }

  async metrics(): Promise<OpsResponse> {
    return { status: 200, contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}
