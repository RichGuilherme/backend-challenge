import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createTestContext, type TestContext } from "../../support/application";
import { testDatabaseConfig } from "../../support/database";
import { ServiceProcess, type TerminatedService } from "../../support/service-process";

const ENTRYPOINT = resolve(import.meta.dir, "../../../src/main/main.ts");

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(() => context?.close());

async function post(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("processo da API", () => {
  test("loga em JSON com o correlationId da requisição, sem valores financeiros, e encerra no SIGTERM", async () => {
    const service = new ServiceProcess(ENTRYPOINT, { DB_NAME: testDatabaseConfig().name, SERVICE_NAME: "api" }, "PORT");
    let terminated!: Promise<TerminatedService>;
    let responseCorrelationId: string | null = null;
    let transactionId = "";
    let walletId = "";

    try {
      await service.waitUntilReachable("/health/live");
      const wallet = (await (
        await post(service.baseUrl, "/wallets", {
          playerId: crypto.randomUUID(),
          initialBalance: { amount: "777.77", currency: "BRL" },
        })
      ).json()) as { id: string; playerId: string };
      walletId = wallet.id;
      const externalTransactionId = `tx-${crypto.randomUUID()}`;

      const bet = await post(
        service.baseUrl,
        "/wagering/transactions",
        {
          providerId: "provider-a",
          externalTransactionId,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: "BET",
          money: { amount: "123.45", currency: "BRL" },
        },
        { "idempotency-key": `provider-a:${externalTransactionId}`, "x-correlation-id": "corr-api-process" },
      );
      responseCorrelationId = bet.headers.get("x-correlation-id");
      transactionId = ((await bet.json()) as { transactionId: string }).transactionId;
      await service.expectOperational();
    } finally {
      terminated = service.terminate();
    }

    const { exitCode, logs, stdout } = await terminated;

    expect([0, 128 + 15]).toContain(exitCode);
    expect(responseCorrelationId).toBe("corr-api-process");
    expect(logs.every((line) => line.service === "api")).toBe(true);

    const requestLog = logs.find((line) => line.correlationId === "corr-api-process" && line.res !== undefined);
    expect(requestLog).toMatchObject({
      correlationId: "corr-api-process",
      req: { id: "corr-api-process", method: "POST", url: "/wagering/transactions" },
      res: { statusCode: 200 },
    });

    const submittedLog = logs.find(
      (line) => line.msg === "transação submetida" && line.transactionId === transactionId,
    );
    expect(submittedLog).toMatchObject({
      correlationId: "corr-api-process",
      transactionId,
      walletId,
      providerId: "provider-a",
      kind: "BET",
      status: "PROCESSED",
      idempotentReplay: false,
    });

    expect(stdout).not.toContain("123.45");
    expect(stdout).not.toContain("777.77");
    const loggedUrls = logs.map((line) => (line.req as { url?: string } | undefined)?.url ?? "");
    expect(loggedUrls.some((url) => url.startsWith("/health") || url.startsWith("/metrics"))).toBe(false);
    expect(loggedUrls).toContain("/wagering/transactions");
  }, 60_000);
});
