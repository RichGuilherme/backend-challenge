import { Gauge, type Registry } from "prom-client";
import type { OutboxLagQuery } from "../../application/ports/outbox-lag.query";

export function registerOutboxLagGauge(registry: Registry, query: OutboxLagQuery): void {
  new Gauge({
    name: "wagering_outbox_lag_seconds",
    help: "Idade, em segundos, da mensagem pendente mais antiga da outbox",
    registers: [registry],
    async collect() {
      try {
        this.set(await query.oldestPendingAgeSeconds());
      } catch {
        this.set(Number.NaN);
      }
    },
  });
}
