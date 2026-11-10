import { Inject, Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import { registerOutboxLagGauge } from "../infrastructure/observability/outbox-lag-gauge";
import { SqlOutboxLagQuery } from "../infrastructure/persistence/sql-outbox-lag.query";
import { InfrastructureModule } from "./infrastructure.module";
import { METRICS_REGISTRY } from "./tokens";

@Module({ imports: [InfrastructureModule] })
export class OutboxLagModule {
  constructor(@Inject(MikroORM) orm: MikroORM, @Inject(METRICS_REGISTRY) registry: Registry) {
    registerOutboxLagGauge(registry, new SqlOutboxLagQuery(orm.em));
  }
}
