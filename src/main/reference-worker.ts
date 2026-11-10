import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ReferenceWorkerModule } from "./reference-worker.module";

const app = await NestFactory.createApplicationContext(ReferenceWorkerModule);
app.enableShutdownHooks();
