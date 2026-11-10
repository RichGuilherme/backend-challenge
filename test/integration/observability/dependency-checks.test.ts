import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import { ReadinessProbe } from "../../../src/application/observability/readiness-probe";
import { PostgresCheck } from "../../../src/infrastructure/observability/postgres-check";
import { SnsTopicCheck } from "../../../src/infrastructure/observability/sns-topic-check";
import { SqsQueueCheck } from "../../../src/infrastructure/observability/sqs-queue-check";
import { createMikroOrmOptions } from "../../../src/infrastructure/persistence/mikro-orm.config";
import { loadAwsConfig, loadOutboxConfig, requireEnv } from "../../../src/shared/config/env";
import { createTestContext, type TestContext } from "../../support/application";
import { testDatabaseConfig } from "../../support/database";

let context: TestContext;
let unreachableOrm: MikroORM;
const clients: { destroy(): void }[] = [];

const DEAD_ENDPOINT = "http://127.0.0.1:1";

function sqsClient(endpoint = loadAwsConfig().endpoint): SQSClient {
  const client = new SQSClient({ region: loadAwsConfig().region, maxAttempts: 1, ...(endpoint ? { endpoint } : {}) });
  clients.push(client);
  return client;
}

function snsClient(endpoint = loadAwsConfig().endpoint): SNSClient {
  const client = new SNSClient({ region: loadAwsConfig().region, maxAttempts: 1, ...(endpoint ? { endpoint } : {}) });
  clients.push(client);
  return client;
}

const noSignal = new AbortController().signal;

beforeAll(async () => {
  context = await createTestContext();
  unreachableOrm = await MikroORM.init(createMikroOrmOptions({ ...testDatabaseConfig(), host: "127.0.0.1", port: 1 }));
});

afterAll(async () => {
  for (const client of clients) client.destroy();
  await unreachableOrm?.close(true);
  await context?.close();
});

describe("PostgresCheck", () => {
  test("banco no ar → ok", async () => {
    await expect(new PostgresCheck(context.orm).check(noSignal)).resolves.toBeUndefined();
  });

  test("banco inalcançável → falha", async () => {
    await expect(new PostgresCheck(unreachableOrm).check(noSignal)).rejects.toThrow();
  });

  test("o nome identifica a dependência no relatório", () => {
    expect(new PostgresCheck(context.orm).name).toBe("postgres");
  });
});

describe("SqsQueueCheck", () => {
  const queueName = () => requireEnv("SQS_QUEUE_NAME");

  test("fila existente → ok", async () => {
    await expect(new SqsQueueCheck(sqsClient(), queueName()).check(noSignal)).resolves.toBeUndefined();
  });

  test("fila inexistente → falha", async () => {
    await expect(new SqsQueueCheck(sqsClient(), "nao-existe.fifo").check(noSignal)).rejects.toThrow();
  });

  test("SQS inalcançável → falha", async () => {
    await expect(new SqsQueueCheck(sqsClient(DEAD_ENDPOINT), queueName()).check(noSignal)).rejects.toThrow();
  });

  test("o nome identifica a dependência no relatório", () => {
    expect(new SqsQueueCheck(sqsClient(), queueName()).name).toBe("sqs");
  });
});

describe("SnsTopicCheck", () => {
  test("tópico existente → ok", async () => {
    const check = new SnsTopicCheck(snsClient(), loadOutboxConfig().topicArn);
    await expect(check.check(noSignal)).resolves.toBeUndefined();
    expect(check.name).toBe("sns");
  });

  test("SNS inalcançável → falha", async () => {
    const check = new SnsTopicCheck(snsClient(DEAD_ENDPOINT), loadOutboxConfig().topicArn);
    await expect(check.check(noSignal)).rejects.toThrow();
  });
});

describe("relatório de readiness com as dependências reais", () => {
  test("tudo no ar → pronto", async () => {
    const probe = new ReadinessProbe(
      [new PostgresCheck(context.orm), new SqsQueueCheck(sqsClient(), requireEnv("SQS_QUEUE_NAME"))],
      2_000,
    );
    expect(await probe.check()).toEqual({
      ready: true,
      dependencies: { postgres: { status: "up" }, sqs: { status: "up" } },
    });
  });

  test("banco parado → não pronto, e o SQS continua 'up'", async () => {
    const probe = new ReadinessProbe(
      [new PostgresCheck(unreachableOrm), new SqsQueueCheck(sqsClient(), requireEnv("SQS_QUEUE_NAME"))],
      2_000,
    );

    const report = await probe.check();

    expect(report.ready).toBe(false);
    expect(report.dependencies.postgres?.status).toBe("down");
    expect(report.dependencies.sqs).toEqual({ status: "up" });
  });

  test("SQS parado → não pronto, e o banco continua 'up'", async () => {
    const probe = new ReadinessProbe(
      [new PostgresCheck(context.orm), new SqsQueueCheck(sqsClient(DEAD_ENDPOINT), requireEnv("SQS_QUEUE_NAME"))],
      2_000,
    );

    const report = await probe.check();

    expect(report.ready).toBe(false);
    expect(report.dependencies.postgres).toEqual({ status: "up" });
    expect(report.dependencies.sqs?.status).toBe("down");
  });
});
