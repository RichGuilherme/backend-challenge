import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestContext, type TestContext } from "../../support/application";
import { requestJson, startTestHttpApp, type TestHttpApp } from "../../support/http";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

let context: TestContext;
let http: TestHttpApp;

beforeAll(async () => {
  context = await createTestContext();
  http = await startTestHttpApp();
});

afterAll(async () => {
  await http?.close();
  await context?.close();
});

const newPlayer = () => crypto.randomUUID();
const createWallet = (body: unknown) => requestJson(`${http.baseUrl}/wallets`, { method: "POST", body });

describe("POST /wallets", () => {
  test("201 com o formato do README", async () => {
    const playerId = newPlayer();

    const response = await createWallet({ playerId, initialBalance: { amount: "1000.00", currency: "BRL" } });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      playerId,
      balance: { amount: "1000.00", currency: "BRL" },
      version: 1,
    });
    await expectWalletMatchesLedger(context.sql, String(response.body.id));
  });

  test("valor de entrada é normalizado para 2 casas", async () => {
    const response = await createWallet({ playerId: newPlayer(), initialBalance: { amount: "25.5", currency: "BRL" } });
    expect(response.body.balance).toEqual({ amount: "25.50", currency: "BRL" });
  });

  test("409 para wallet duplicada do mesmo player e moeda", async () => {
    const playerId = newPlayer();
    await createWallet({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });

    const response = await createWallet({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: "WALLET_ALREADY_EXISTS" });
  });

  test.each<[string, unknown]>([
    ["sem playerId", { initialBalance: { amount: "10.00", currency: "BRL" } }],
    ["sem initialBalance", { playerId: "p" }],
    ["amount number", { playerId: "p", initialBalance: { amount: 10, currency: "BRL" } }],
    ["amount com 3 casas", { playerId: "p", initialBalance: { amount: "10.001", currency: "BRL" } }],
    ["amount negativo", { playerId: "p", initialBalance: { amount: "-1.00", currency: "BRL" } }],
    ["notação científica", { playerId: "p", initialBalance: { amount: "1e3", currency: "BRL" } }],
    ["moeda inválida", { playerId: "p", initialBalance: { amount: "10.00", currency: "real" } }],
    ["corpo não é objeto", ["x"]],
  ])("400 para %s", async (_label, body) => {
    const response = await createWallet(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
  });

  test("400 para JSON malformado", async () => {
    const response = await requestJson(`${http.baseUrl}/wallets`, { method: "POST", rawBody: "{ quebrado" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
  });
});

describe("GET /wallets/:walletId", () => {
  test("200 com a wallet", async () => {
    const created = await createWallet({ playerId: newPlayer(), initialBalance: { amount: "5.00", currency: "BRL" } });

    const response = await requestJson(`${http.baseUrl}/wallets/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  test("404 para wallet inexistente", async () => {
    const response = await requestJson(`${http.baseUrl}/wallets/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "WALLET_NOT_FOUND" });
  });

  test("400 para id que não é UUID", async () => {
    const response = await requestJson(`${http.baseUrl}/wallets/nao-e-uuid`);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
  });
});
