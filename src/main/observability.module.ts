import { Global, Module } from "@nestjs/common";
import { Registry } from "prom-client";
import { METRICS_REGISTRY } from "./tokens";

@Global()
@Module({
  providers: [{ provide: METRICS_REGISTRY, useFactory: () => new Registry() }],
  exports: [METRICS_REGISTRY],
})
export class ObservabilityModule {}
