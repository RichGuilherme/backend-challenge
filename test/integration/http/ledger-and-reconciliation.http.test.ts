import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LedgerEntryView } from "../../../src/application/ports/ledger.query";
import { createTestContext, type TestContext } from "../../support/application";
import { requestJson, startTestHttpApp, type TestHttpApp } from "../../support/http";

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

interface LedgerPage {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

async function walletWithBets(bets: number): Promise<Wallet> {
  const { body: wallet } = await requestJson<Wallet>(`${http.baseUrl}/wallets`, {
    method: "POST",
    body: { playerId: crypto.randomUUID(), initialBalance: { amount: "100.00", currency: "BRL" } },
  });
  for (let index = 0; index < bets; index += 1) await bet(wallet, "1.00");
  return wallet;
}

async function bet(wallet: Wallet, amount: string): Promise<void> {
  const externalTransactionId = `tx-${crypto.randomUUID()}`;
  await requestJson(`${http.baseUrl}/wagering/transactions`, {
    method: "POST",
    headers: { "Idempotency-Key": `provider-a:${externalTransactionId}` },
    body: {
      providerId: "provider-a",
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "game-1",
      kind: "BET",
      money: { amount, currency: "BRL" },
    },
  });
}

const ledger = (walletId: string, query = "") =>
  requestJson<LedgerPage>(`${http.baseUrl}/wallets/${walletId}/ledger${query}`);

const reconcile = (walletId: string) =>
  requestJson(`${http.baseUrl}/wallets/${walletId}/reconciliation`, { method: "POST" });

async function forceBalance(walletId: string, balance: string): Promise<void> {
  await context.sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update wallets set balance = ${balance} where id = ${walletId}`;
  });
}

describe("GET /wallets/:walletId/ledger", () => {
  test("pagina em ordem cronológica com cursor opaco até o fim", async () => {
    const wallet = await walletWithBets(4);

    const first = await ledger(wallet.id, "?limit=2");
    const second = await ledger(wallet.id, `?limit=2&cursor=${first.body.nextCursor}`);
    const third = await ledger(wallet.id, `?limit=2&cursor=${second.body.nextCursor}`);

    expect(first.status).toBe(200);
    expect(first.body.entries.map((entry) => entry.walletVersion)).toEqual([1, 2]);
    expect(second.body.entries.map((entry) => entry.walletVersion)).toEqual([3, 4]);
    expect(third.body.entries.map((entry) => entry.walletVersion)).toEqual([5]);
    expect(third.body.nextCursor).toBeNull();
    expect(first.body.nextCursor).not.toBe("2");
    expect(first.body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.body.entries[0]).toEqual({
      id: expect.any(String),
      transactionId: expect.any(String),
      walletVersion: 1,
      direction: "CREDIT",
      money: { amount: "100.00", currency: "BRL" },
      balanceBefore: { amount: "0.00", currency: "BRL" },
      balanceAfter: { amount: "100.00", currency: "BRL" },
      createdAt: expect.any(String),
    });
  });

  test("o cursor é estável: lançamentos novos não deslocam as páginas já lidas", async () => {
    const wallet = await walletWithBets(2);
    const first = await ledger(wallet.id, "?limit=2");

    await bet(wallet, "5.00");
    const second = await ledger(wallet.id, `?limit=2&cursor=${first.body.nextCursor}`);

    expect(second.body.entries.map((entry) => entry.walletVersion)).toEqual([3, 4]);
    expect(second.body.entries[1]?.money.amount).toBe("5.00");
  });

  test("limite padrão é 50", async () => {
    const wallet = await walletWithBets(0);
    const page = await ledger(wallet.id);
    expect(page.body.entries).toHaveLength(1);
    expect(page.body.nextCursor).toBeNull();
  });

  test.each([["?limit=0"], ["?limit=201"], ["?limit=abc"], ["?cursor=nao-e-cursor"], ["?cursor=eyJ2IjotMX0"]])(
    "400 para %s",
    async (query) => {
      const wallet = await walletWithBets(0);
      const response = await ledger(wallet.id, query);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "INVALID_PAYLOAD" });
    },
  );

  test("404 para wallet inexistente", async () => {
    const response = await ledger(crypto.randomUUID());
    expect(response.status).toBe(404);
  });
});

describe("POST /wallets/:walletId/reconciliation", () => {
  test("wallet consistente: formato do README", async () => {
    const wallet = await walletWithBets(3);

    const response = await reconcile(wallet.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: wallet.id,
      storedBalance: { amount: "97.00", currency: "BRL" },
      calculatedBalance: { amount: "97.00", currency: "BRL" },
      difference: { amount: "0.00", currency: "BRL" },
      consistent: true,
      checkedEntries: 4,
    });
  });

  test("divergência forçada no banco é detectada e sinalizada, sem correção silenciosa", async () => {
    const wallet = await walletWithBets(1);
    await forceBalance(wallet.id, "150.00");

    const response = await reconcile(wallet.id);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storedBalance: { amount: "150.00" },
      calculatedBalance: { amount: "99.00" },
      difference: { amount: "51.00" },
      consistent: false,
      checkedEntries: 2,
    });
    const [row] = await context.sql`select balance from wallets where id = ${wallet.id}`;
    expect(row.balance).toBe("150.00");
  });

  test("divergência para baixo aparece com diferença negativa", async () => {
    const wallet = await walletWithBets(0);
    await forceBalance(wallet.id, "40.00");
    const response = await reconcile(wallet.id);
    expect(response.body).toMatchObject({ difference: { amount: "-60.00" }, consistent: false });
  });

  test("404 para wallet inexistente", async () => {
    const response = await reconcile(crypto.randomUUID());
    expect(response.status).toBe(404);
  });
});
