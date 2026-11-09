import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SubmitWagerTransactionUseCase } from "../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../src/application/wallet/wallet.view";
import { FailureCode } from "../../src/domain/wagering/failure-code";
import { WagerTransactionStatus } from "../../src/domain/wagering/wager-transaction-status";
import { createTestContext, type TestContext } from "../support/application";
import { submitCommand } from "../support/commands";
import { expectAllWalletsMatchLedger, expectWalletMatchesLedger } from "../support/ledger-invariant";

let context: TestContext;
let openWallet: OpenWalletUseCase;
let submit: SubmitWagerTransactionUseCase;

beforeAll(async () => {
  context = await createTestContext({ lockTimeoutMs: 10_000 });
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
  submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
});

afterAll(async () => {
  await expectAllWalletsMatchLedger(context.sql);
  await context?.close();
});

const open = (amount: string): Promise<WalletView> =>
  openWallet.execute({ playerId: `player-${crypto.randomUUID()}`, initialBalance: { amount, currency: "BRL" } });

async function debitsOf(walletId: string): Promise<number> {
  const [row] = await context.sql`
    select count(*)::int as debits from wallet_ledger_entries where wallet_id = ${walletId} and direction = 'DEBIT'`;
  return row.debits;
}

async function balanceOf(walletId: string): Promise<string> {
  const [row] = await context.sql`select balance from wallets where id = ${walletId}`;
  return row.balance;
}

describe("concorrência real no mesmo processo (transações SQL simultâneas)", () => {
  test("cenário obrigatório: 100.00 e duas apostas de 80.00 simultâneas", async () => {
    const wallet = await open("100.00");
    const bet = () => submitCommand(wallet.id, wallet.playerId, { money: { amount: "80.00", currency: "BRL" } });

    const results = await Promise.all([submit.execute(bet()), submit.execute(bet())]);

    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected].sort());
    expect(results.find((result) => result.status === WagerTransactionStatus.Rejected)?.failureCode).toBe(
      FailureCode.InsufficientFunds,
    );
    expect(await balanceOf(wallet.id)).toBe("20.00");
    expect(await debitsOf(wallet.id)).toBe(1);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("a mesma aposta 50 vezes em paralelo gera um único débito", async () => {
    const wallet = await open("100.00");
    const sameBet = submitCommand(wallet.id, wallet.playerId);

    const results = await Promise.all(Array.from({ length: 50 }, () => submit.execute(sameBet)));

    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(results.every((result) => result.balance.amount === "75.00")).toBe(true);
    expect(await balanceOf(wallet.id)).toBe("75.00");
    expect(await debitsOf(wallet.id)).toBe(1);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("hot wallet: 30 apostas distintas de 10.00 sobre 100.00 → exatamente 10 passam e o saldo zera", async () => {
    const wallet = await open("100.00");

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        submit.execute(submitCommand(wallet.id, wallet.playerId, { money: { amount: "10.00", currency: "BRL" } })),
      ),
    );

    expect(results.filter((result) => result.status === WagerTransactionStatus.Processed)).toHaveLength(10);
    expect(results.filter((result) => result.status === WagerTransactionStatus.Rejected)).toHaveLength(20);
    expect(await balanceOf(wallet.id)).toBe("0.00");
    expect(await debitsOf(wallet.id)).toBe(10);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });

  test("wallets distintas em paralelo não interferem entre si", async () => {
    const wallets = await Promise.all(Array.from({ length: 10 }, () => open("50.00")));

    await Promise.all(
      wallets.flatMap((wallet) =>
        Array.from({ length: 5 }, () =>
          submit.execute(submitCommand(wallet.id, wallet.playerId, { money: { amount: "10.00", currency: "BRL" } })),
        ),
      ),
    );

    for (const wallet of wallets) {
      expect(await balanceOf(wallet.id)).toBe("0.00");
      expect(await debitsOf(wallet.id)).toBe(5);
      await expectWalletMatchesLedger(context.sql, wallet.id);
    }
  });
});
