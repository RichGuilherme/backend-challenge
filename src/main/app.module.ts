import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { SQSClient } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { LoggerModule } from "nestjs-pino";
import type { Registry } from "prom-client";
import { createSqsClient } from "../infrastructure/messaging/aws-clients";
import { PostgresCheck } from "../infrastructure/observability/postgres-check";
import { createRootLogger } from "../infrastructure/observability/pino-logger";
import { SqsQueueCheck } from "../infrastructure/observability/sqs-queue-check";
import { AuthGuard } from "../presentation/http/auth.guard";
import { HttpErrorFilter } from "../presentation/http/http-error.filter";
import { assignCorrelationId, isQuietRequest } from "../presentation/http/http-logging";
import { OpsController } from "../presentation/http/ops.controller";
import { WageringTransactionsController } from "../presentation/http/wagering-transactions.controller";
import { WalletsController } from "../presentation/http/wallets.controller";
import { OpsEndpoints } from "../presentation/ops/ops-endpoints";
import { loadAwsConfig, loadConsumerConfig, loadLoggingConfig } from "../shared/config/env";
import { createOpsEndpoints } from "./ops";
import { InfrastructureModule } from "./infrastructure.module";
import { OutboxLagModule } from "./outbox-lag.module";
import { METRICS_REGISTRY } from "./tokens";
import { UseCasesModule } from "./use-cases.module";

@Module({
  imports: [
    InfrastructureModule,
    UseCasesModule,
    OutboxLagModule,
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          logger: createRootLogger(loadLoggingConfig()),
          genReqId: assignCorrelationId,
          customProps: (request) => ({ correlationId: request.id }),
          serializers: {
            req: (request: { id: string; method: string; url: string }) => ({
              id: request.id,
              method: request.method,
              url: request.url,
            }),
            res: (response: { statusCode: number }) => ({ statusCode: response.statusCode }),
          },
          autoLogging: { ignore: isQuietRequest },
        },
      }),
    }),
  ],
  controllers: [WalletsController, WageringTransactionsController, OpsController],
  providers: [
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: SQSClient, useFactory: () => createSqsClient(loadAwsConfig()) },
    {
      provide: OpsEndpoints,
      inject: [METRICS_REGISTRY, MikroORM, SQSClient],
      useFactory: (registry: Registry, orm: MikroORM, sqs: SQSClient) =>
        createOpsEndpoints(registry, [new PostgresCheck(orm), new SqsQueueCheck(sqs, loadConsumerConfig().queueName)]),
    },
  ],
})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(SQSClient) private readonly sqs: SQSClient) {}

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}
