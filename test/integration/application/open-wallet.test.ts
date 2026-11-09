import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GetWalletUseCase } from "../../../src/application/wallet/get-wallet.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { WalletAlreadyExistsError, WalletNotFoundError } from "../../../src/application/wallet/wallet.errors";
import { createTestContext, type TestContext } from "../../support/application";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

let context: TestContext;
let openWallet: OpenWalletUseCase;
let getWallet: GetWalletUseCase;

beforeAll(async () => {
  context = await createTestContext();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
  getWallet = new GetWalletUseCase(context.unitOfWork);
});

afterAll(() => context?.close());

const newPlayer = () => `player-${crypto.randomUUID()}`;

describe("OpenWalletUseCase", () => {
  test("saldo inicial positivo: wallet versão 1, transação OPENING e um CREDIT, gravados juntos", async () => {
    const playerId = newPlayer();

    const view = await openWallet.execute({ playerId, initialBalance: { amount: "1000.00", currency: "BRL" } });

    expect(view).toEqual({ id: view.id, playerId, balance: { amount: "1000.00", currency: "BRL" }, version: 1 });
    const [opening] = await context.sql`
      select kind, status, provider_id, idempotency_key, amount, observed_balance
      from wager_transactions where wallet_id = ${view.id}`;
    expect(opening).toEqual({
      kind: "OPENING",
      status: "PROCESSED",
      provider_id: "internal",
      idempotency_key: `opening:${view.id}`,
      amount: "1000.00",
      observed_balance: "1000.00",
    });
    const entries = await context.sql`
      select direction, amount, balance_before, balance_after, wallet_version
      from wallet_ledger_entries where wallet_id = ${view.id}`;
    expect(entries).toEqual([
      { direction: "CREDIT", amount: "1000.00", balance_before: "0.00", balance_after: "1000.00", wallet_version: 1 },
    ]);
    await expectWalletMatchesLedger(context.sql, view.id);
  });

  test("saldo inicial zero: wallet versão 1 sem transação e sem lançamento", async () => {
    const view = await openWallet.execute({ playerId: newPlayer(), initialBalance: { amount: "0", currency: "BRL" } });

    expect(view.balance).toEqual({ amount: "0.00", currency: "BRL" });
    const [counts] = await context.sql`
      select
        (select count(*)::int from wager_transactions where wallet_id = ${view.id}) as transactions,
        (select count(*)::int from wallet_ledger_entries where wallet_id = ${view.id}) as entries`;
    expect(counts).toEqual({ transactions: 0, entries: 0 });
    await expectWalletMatchesLedger(context.sql, view.id);
  });

  test("wallet duplicada para o mesmo player e moeda é conflito", async () => {
    const playerId = newPlayer();
    await openWallet.execute({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });

    await expect(
      openWallet.execute({ playerId, initialBalance: { amount: "20.00", currency: "BRL" } }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
    const [row] = await context.sql`select count(*)::int as count from wallets where player_id = ${playerId}`;
    expect(row.count).toBe(1);
  });

  test("o mesmo player pode ter wallet em outra moeda", async () => {
    const playerId = newPlayer();
    await openWallet.execute({ playerId, initialBalance: { amount: "10.00", currency: "BRL" } });
    const usd = await openWallet.execute({ playerId, initialBalance: { amount: "5.00", currency: "USD" } });
    expect(usd.balance).toEqual({ amount: "5.00", currency: "USD" });
  });

  test("aberturas simultâneas para o mesmo player e moeda: exatamente uma vence", async () => {
    const playerId = newPlayer();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        openWallet.execute({ playerId, initialBalance: { amount: "50.00", currency: "BRL" } }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(9);
    for (const { reason } of rejected) expect(reason).toBeInstanceOf(WalletAlreadyExistsError);
    const [row] = await context.sql`
      select count(*)::int as wallets,
        (select count(*)::int from wallet_ledger_entries e join wallets w on w.id = e.wallet_id
          where w.player_id = ${playerId}) as entries
      from wallets where player_id = ${playerId}`;
    expect(row).toEqual({ wallets: 1, entries: 1 });
  });
});

describe("GetWalletUseCase", () => {
  test("devolve a wallet", async () => {
    const opened = await openWallet.execute({ playerId: newPlayer(), initialBalance: { amount: "7.50", currency: "BRL" } });
    expect(await getWallet.execute(opened.id)).toEqual(opened);
  });

  test("wallet inexistente", async () => {
    await expect(getWallet.execute(crypto.randomUUID())).rejects.toBeInstanceOf(WalletNotFoundError);
  });
});
