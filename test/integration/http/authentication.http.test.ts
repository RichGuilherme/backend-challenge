import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestContext, type TestContext } from "../../support/application";
import { requestJson, startTestHttpApp, type TestHttpApp } from "../../support/http";
import { FakeIdentityProvider, foreignSigningKey, type IssueOptions } from "../../support/identity-provider";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

let context: TestContext;
let idp: FakeIdentityProvider;
let http: TestHttpApp;

beforeAll(async () => {
  context = await createTestContext();
  idp = await FakeIdentityProvider.start();
  http = await startTestHttpApp({
    AUTH_ENABLED: "true",
    AUTH_ISSUER: idp.config.issuer,
    AUTH_JWKS_URI: idp.config.jwksUri,
    AUTH_AUDIENCE: idp.config.audience,
  });
});

afterAll(async () => {
  await http?.close();
  await idp?.stop();
  await context?.close();
});

const tokenFor = async (clientId: string, options: IssueOptions = {}) =>
  `Bearer ${await idp.issue({ clientId, ...options })}`;

const as = (authorization: string | null) => (authorization === null ? {} : { Authorization: authorization });

async function openWallet(authorization: string | null) {
  return requestJson<{ id: string; playerId: string }>(`${http.baseUrl}/wallets`, {
    method: "POST",
    headers: as(authorization),
    body: { playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" } },
  });
}

function bet(wallet: { id: string; playerId: string }, providerId: string) {
  const externalTransactionId = `transaction-${crypto.randomUUID()}`;
  return {
    providerId,
    externalTransactionId,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-1",
    gameId: "game-1",
    kind: "BET",
    money: { amount: "10.00", currency: "BRL" },
  };
}

const submit = (body: ReturnType<typeof bet>, authorization: string | null) =>
  requestJson<Record<string, unknown>>(`${http.baseUrl}/wagering/transactions`, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": `${body.providerId}:${body.externalTransactionId}`, ...as(authorization) },
  });

describe("autenticação habilitada", () => {
  describe("401 sem credencial válida", () => {
    test("sem o header Authorization", async () => {
      const response = await openWallet(null);

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: "UNAUTHENTICATED" });
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    });

    test.each<[string, () => Promise<string>]>([
      ["esquema que não é Bearer", async () => "Basic dXNlcjpzZW5oYQ=="],
      ["Bearer sem token", async () => "Bearer "],
      ["token que não é JWT", async () => "Bearer isto-nao-e-um-jwt"],
      ["token expirado", () => tokenFor("provider-a", { expiresInSeconds: -60 })],
      ["audiência errada", () => tokenFor("provider-a", { audience: "outra-api" })],
      ["emissor errado", () => tokenFor("provider-a", { issuer: "http://outro/realms/x" })],
      ["assinatura de outra chave", async () => tokenFor("provider-a", { signWith: await foreignSigningKey() })],
    ])("%s", async (_label, authorization) => {
      const response = await openWallet(await authorization());

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: "UNAUTHENTICATED" });
    });
  });

  test("a API financeira inteira exige token", async () => {
    const wallet = (await openWallet(await tokenFor("provider-a"))).body;
    const probes = await Promise.all([
      requestJson(`${http.baseUrl}/wallets/${wallet.id}`),
      requestJson(`${http.baseUrl}/wallets/${wallet.id}/ledger`),
      requestJson(`${http.baseUrl}/wallets/${wallet.id}/reconciliation`, { method: "POST" }),
      requestJson(`${http.baseUrl}/wagering/transactions/${crypto.randomUUID()}`),
      requestJson(`${http.baseUrl}/providers/provider-a/wagering/transactions/x`),
    ]);

    expect(probes.map((probe) => probe.status)).toEqual([401, 401, 401, 401, 401]);
  });

  test("health e métricas continuam abertos, sem token", async () => {
    const [live, ready, metrics] = await Promise.all([
      fetch(`${http.baseUrl}/health/live`),
      fetch(`${http.baseUrl}/health/ready`),
      fetch(`${http.baseUrl}/metrics`),
    ]);

    expect([live.status, ready.status, metrics.status]).toEqual([200, 200, 200]);
  });

  describe("autorização por provedor", () => {
    test("provedor autenticado opera as próprias transações", async () => {
      const wallet = (await openWallet(await tokenFor("provider-a"))).body;

      const response = await submit(bet(wallet, "provider-a"), await tokenFor("provider-a"));

      expect(response.status).toBe(200);
      await expectWalletMatchesLedger(context.sql, wallet.id);
    });

    test("403 quando o providerId do corpo não é o do token, e nada é gravado", async () => {
      const wallet = (await openWallet(await tokenFor("provider-a"))).body;

      const response = await submit(bet(wallet, "provider-b"), await tokenFor("provider-a"));

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: "PROVIDER_FORBIDDEN" });
      const [row] =
        await context.sql`select count(*)::int as count from wager_transactions where wallet_id = ${wallet.id}`;
      expect(row.count).toBe(1);
    });

    test("consulta por provedor: 403 para outro provedor e 200 para o dono", async () => {
      const wallet = (await openWallet(await tokenFor("provider-a"))).body;
      const body = bet(wallet, "provider-a");
      await submit(body, await tokenFor("provider-a"));
      const path = `${http.baseUrl}/providers/provider-a/wagering/transactions/${body.externalTransactionId}`;

      const foreign = await requestJson(path, { headers: as(await tokenFor("provider-b")) });
      const owner = await requestJson(path, { headers: as(await tokenFor("provider-a")) });

      expect(foreign.status).toBe(403);
      expect(owner.status).toBe(200);
    });

    test("consulta por id interno: transação de outro provedor aparece como 404, sem vazar existência", async () => {
      const wallet = (await openWallet(await tokenFor("provider-a"))).body;
      const created = await submit(bet(wallet, "provider-a"), await tokenFor("provider-a"));
      const path = `${http.baseUrl}/wagering/transactions/${created.body.transactionId}`;

      const foreign = await requestJson(path, { headers: as(await tokenFor("provider-b")) });
      const owner = await requestJson(path, { headers: as(await tokenFor("provider-a")) });

      expect(foreign.status).toBe(404);
      expect(foreign.body).toMatchObject({ error: "TRANSACTION_NOT_FOUND" });
      expect(owner.status).toBe(200);
    });
  });

  test("503 com Retry-After quando o provedor de identidade está fora e não há chaves em cache", async () => {
    const offline = await startTestHttpApp({
      AUTH_ENABLED: "true",
      AUTH_ISSUER: idp.config.issuer,
      AUTH_JWKS_URI: "http://127.0.0.1:1/certs",
      AUTH_AUDIENCE: idp.config.audience,
    });

    try {
      const response = await requestJson(`${offline.baseUrl}/wallets`, {
        method: "POST",
        headers: as(await tokenFor("provider-a")),
        body: { playerId: crypto.randomUUID(), initialBalance: { amount: "1.00", currency: "BRL" } },
      });

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
    } finally {
      await offline.close();
    }
  });
});
