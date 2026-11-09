import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/main/app.module";
import { testDatabaseConfig } from "./database";

export interface TestHttpApp {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startTestHttpApp(env: Record<string, string> = {}): Promise<TestHttpApp> {
  const overrides: Record<string, string> = { DB_NAME: testDatabaseConfig().name, ...env };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);

  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await app.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

export interface JsonResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {},
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...init.headers },
    ...(init.rawBody !== undefined
      ? { body: init.rawBody }
      : init.body !== undefined
        ? { body: JSON.stringify(init.body) }
        : {}),
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as T };
}
