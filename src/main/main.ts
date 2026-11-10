import "reflect-metadata";
import type { Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { NestPinoLogger } from "../infrastructure/observability/nest-pino-logger";
import { createRootLogger } from "../infrastructure/observability/pino-logger";
import { loadLoggingConfig } from "../shared/config/env";

async function startApi(): Promise<void> {
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? "3000");
}

async function startWorker(loadModule: () => Promise<Type<unknown>>): Promise<void> {
  const app = await NestFactory.createApplicationContext(await loadModule(), {
    logger: new NestPinoLogger(createRootLogger(loadLoggingConfig())),
  });
  app.enableShutdownHooks();
}

const ROLES: Readonly<Record<string, () => Promise<void>>> = {
  api: startApi,
  consumer: () => startWorker(async () => (await import("./consumer.module")).ConsumerModule),
  "outbox-publisher": () => startWorker(async () => (await import("./outbox-publisher.module")).OutboxPublisherModule),
  "reference-worker": () => startWorker(async () => (await import("./reference-worker.module")).ReferenceWorkerModule),
};

const role = process.argv[2] ?? "api";
const start = ROLES[role];
if (!start) {
  console.error(`Papel desconhecido: ${role}. Use um de: ${Object.keys(ROLES).join(", ")}`);
  process.exit(1);
}

await start();
