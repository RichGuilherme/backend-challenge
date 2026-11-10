import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestPinoLogger } from "../infrastructure/observability/nest-pino-logger";
import { createRootLogger } from "../infrastructure/observability/pino-logger";
import { loadLoggingConfig } from "../shared/config/env";

export async function bootstrapWorker(module: Type<unknown>): Promise<void> {
  const app = await NestFactory.createApplicationContext(module, {
    logger: new NestPinoLogger(createRootLogger(loadLoggingConfig())),
  });
  app.enableShutdownHooks();
}
