import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConsumerModule } from "./consumer.module";

const app = await NestFactory.createApplicationContext(ConsumerModule);
app.enableShutdownHooks();
