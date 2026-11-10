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

interface Wallet {
  id: string;
  playerId: string;
}

async function openWallet(amount = "100.00"): Promise<Wallet> {
  const response = await requestJson<Wallet>(`${http.baseUrl}/wallets`, {
    method: "POST",
    body: { playerId: crypto.randomUUID(), initialBalance: { amount, currency: "BRL" } },
  });
  return response.body;
}

function transactionBody(wallet: Wallet, overrides: Record<string, unknown> = {}) {
  return {
    providerId: "provider-a",
    externalTransactionId: `transaction-${crypto.randomUUID()}`,
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: "round-987",
    gameId: "fortune-chimp",
    kind: "BET",
    money: { amount: "25.00", currency: "BRL" },
    ...overrides,
  };
}

const keyOf = (body: { providerId: unknown; externalTransactionId: unknown }) =>
  `${body.providerId}:${body.externalTransactionId}`;

function submit(
  body: Record<string, unknown>,
  idempotencyKey: string | null = keyOf(body as never),
  baseUrl = http.baseUrl,
) {
  return requestJson(`${baseUrl}/wagering/transactions`, {
    method: "POST",
    body,
    headers: idempotencyKey === null ? {} : { "Idempotency-Key": idempotencyKey },
  });
}

describe("POST /wagering/transactions", () => {
  test("200 PROCESSED com o formato do README", async () => {
    const wallet = await openWallet("1000.00");

    const response = await submit(transactionBody(wallet));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      transactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: "PROCESSED",
      balance: { amount: "975.00", currency: "BRL" },
      idempotentReplay: false,
    });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("422 REJECTED com failureCode, transação registrada e saldo intacto", async () => {
    const wallet = await openWallet("10.00");

    const response = await submit(transactionBody(wallet, { money: { amount: "10.01", currency: "BRL" } }));

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      transactionId: expect.any(String),
      status: "REJECTED",
      failureCode: "INSUFFICIENT_FUNDS",
      balance: { amount: "10.00", currency: "BRL" },
      idempotentReplay: false,
    });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("202 PENDING_REFERENCE para reversão que chega antes da referência", async () => {
    const wallet = await openWallet();

    const response = await submit(
      transactionBody(wallet, { kind: "REFUND", referenceExternalTransactionId: "transaction-que-ainda-nao-chegou" }),
    );

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: "PENDING_REFERENCE", balance: { amount: "100.00" } });
  });

  describe("replay devolve o mesmo status e corpo, com idempotentReplay", () => {
    test.each<[string, string, Record<string, unknown>, number]>([
      ["PROCESSED", "100.00", {}, 200],
      ["REJECTED", "1.00", {}, 422],
      ["PENDING_REFERENCE", "100.00", { kind: "ROLLBACK", referenceExternalTransactionId: "nao-chegou" }, 202],
    ])("%s", async (_status, balance, overrides, expectedStatus) => {
      const wallet = await openWallet(balance);
      const body = transactionBody(wallet, overrides);
      const original = await submit(body);

      const replay = await submit(body);

      expect(original.status).toBe(expectedStatus);
      expect(replay.status).toBe(expectedStatus);
      expect(replay.body).toEqual({ ...original.body, idempotentReplay: true });
    });
  });

  test("409 para a mesma chave com payload diferente", async () => {
    const wallet = await openWallet();
    const body = transactionBody(wallet);
    await submit(body);

    const response = await submit({ ...body, money: { amount: "30.00", currency: "BRL" } }, keyOf(body));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: "IDEMPOTENCY_CONFLICT", reason: "PAYLOAD_MISMATCH" });
  });

  test("a mesma Idempotency-Key em provedores diferentes não conflita", async () => {
    const wallet = await openWallet("1000.00");
    const first = transactionBody(wallet, { providerId: "provider-a" });
    const second = transactionBody(wallet, { providerId: "provider-b" });

    const responseA = await submit(first, "chave-compartilhada");
    const responseB = await submit(second, "chave-compartilhada");

    expect([responseA.status, responseB.status]).toEqual([200, 200]);
    expect(responseB.body.transactionId).not.toBe(responseA.body.transactionId);
    expect(responseB.body).toMatchObject({ idempotentReplay: false, balance: { amount: "950.00" } });
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("409 para a mesma transação do provedor com outra chave", async () => {
    const wallet = await openWallet();
    const body = transactionBody(wallet);
    await submit(body);

    const response = await submit(body, "outra-chave");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: "IDEMPOTENCY_CONFLICT", reason: "KEY_MISMATCH" });
  });

  test("404 para wallet inexistente", async () => {
    const response = await submit(transactionBody({ id: crypto.randomUUID(), playerId: "p" }));
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "WALLET_NOT_FOUND" });
  });

  test("400 para wallet de outro player", async () => {
    const wallet = await openWallet();
    const response = await submit(transactionBody({ id: wallet.id, playerId: "outro-player" }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "WALLET_PLAYER_MISMATCH" });
  });

  describe("400 para payload inválido, sem registrar nada", () => {
    test("sem o header Idempotency-Key", async () => {
      const wallet = await openWallet();
      const response = await submit(transactionBody(wallet), null);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
    });

    test.each<[string, Record<string, unknown>]>([
      ["kind OPENING", { kind: "OPENING" }],
      ["kind desconhecido", { kind: "JACKPOT" }],
      ["valor zero", { money: { amount: "0.00", currency: "BRL" } }],
      ["valor negativo", { money: { amount: "-1.00", currency: "BRL" } }],
      ["valor number", { money: { amount: 25, currency: "BRL" } }],
      ["valor com 3 casas", { money: { amount: "25.001", currency: "BRL" } }],
      ["REFUND sem referência", { kind: "REFUND" }],
      ["BET com referência", { kind: "BET", referenceExternalTransactionId: "outra" }],
      ["LOSS com referência", { kind: "LOSS", referenceExternalTransactionId: "outra" }],
      ["walletId que não é UUID", { walletId: "abc" }],
      ["providerId vazio", { providerId: "" }],
      ["provider interno reservado", { providerId: "internal" }],
      ["sem roundId", { roundId: undefined }],
    ])("%s", async (_label, overrides) => {
      const wallet = await openWallet();
      const body = transactionBody(wallet, overrides);

      const response = await submit(body, "chave-de-teste-" + crypto.randomUUID());

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
      const [row] =
        await context.sql`select count(*)::int as count from wager_transactions where wallet_id = ${wallet.id}`;
      expect(row.count).toBe(1);
    });
  });

  test("503 com Retry-After quando a wallet está travada além do lock_timeout", async () => {
    const wallet = await openWallet();
    const impatient = await startTestHttpApp({ DB_LOCK_TIMEOUT_MS: "200" });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let signal!: () => void;
    const locked = new Promise<void>((resolve) => (signal = resolve));
    const holder = context.unitOfWork.run(async ({ wallets }) => {
      await wallets.lockById(wallet.id);
      signal();
      await hold;
    });
    await locked;

    try {
      const body = transactionBody(wallet);
      const response = await submit(body, keyOf(body), impatient.baseUrl);
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(response.body).toMatchObject({ error: "TRANSIENT_FAILURE" });
    } finally {
      release();
      await holder;
      await impatient.close();
    }
  });
});

describe("consultas de transação", () => {
  test("GET /wagering/transactions/:transactionId e GET por id do provedor devolvem a mesma transação", async () => {
    const wallet = await openWallet();
    const body = transactionBody(wallet);
    const submitted = await submit(body);

    const byId = await requestJson(`${http.baseUrl}/wagering/transactions/${submitted.body.transactionId}`);
    const byProvider = await requestJson(
      `${http.baseUrl}/providers/${body.providerId}/wagering/transactions/${body.externalTransactionId}`,
    );

    expect(byId.status).toBe(200);
    expect(byProvider.status).toBe(200);
    expect(byId.body).toEqual(byProvider.body);
    expect(byId.body).toMatchObject({
      id: submitted.body.transactionId,
      providerId: "provider-a",
      kind: "BET",
      status: "PROCESSED",
      money: { amount: "25.00", currency: "BRL" },
      observedBalance: { amount: "75.00", currency: "BRL" },
    });
  });

  test("404 para transação inexistente", async () => {
    const byId = await requestJson(`${http.baseUrl}/wagering/transactions/${crypto.randomUUID()}`);
    const byProvider = await requestJson(`${http.baseUrl}/providers/provider-a/wagering/transactions/nao-existe`);
    expect([byId.status, byProvider.status]).toEqual([404, 404]);
    expect(byId.body).toMatchObject({ error: "TRANSACTION_NOT_FOUND" });
  });

  test("400 para id interno que não é UUID", async () => {
    const response = await requestJson(`${http.baseUrl}/wagering/transactions/abc`);
    expect(response.status).toBe(400);
  });
});
