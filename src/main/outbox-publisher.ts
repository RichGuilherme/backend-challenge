import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { OutboxPublisherModule } from "./outbox-publisher.module";

const app = await NestFactory.createApplicationContext(OutboxPublisherModule);
app.enableShutdownHooks();
