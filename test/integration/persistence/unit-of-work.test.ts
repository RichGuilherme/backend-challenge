import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TransientFailureError } from "../../../src/application/shared/application-error";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { WagerTransaction } from "../../../src/domain/wagering/wager-transaction";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import type { WagerTransactionRepository } from "../../../src/domain/wagering/wager-transaction.repository";
import { Wallet } from "../../../src/domain/wallet/wallet";
import { WalletVersionConflictError } from "../../../src/domain/wallet/wallet.errors";
import { MikroOrmUnitOfWork } from "../../../src/infrastructure/persistence/mikro-orm-unit-of-work";
import { createTestContext, type TestContext } from "../../support/application";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";
import { brl } from "../../support/money";

let context: TestContext;
let openWallet: OpenWalletUseCase;

beforeAll(async () => {
  context = await createTestContext();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
});

afterAll(() => context?.close());

const newPlayer = () => `player-${crypto.randomUUID()}`;

const openWith = (amount: string): Promise<WalletView> =>
  openWallet.execute({ playerId: newPlayer(), correlationId: "test-correlation", initialBalance: { amount, currency: "BRL" } });

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function holdWalletLock(walletId: string): Promise<{ release: () => Promise<void> }> {
  const locked = deferred();
  const hold = deferred();
  const holder = context.unitOfWork.run(async ({ wallets }) => {
    await wallets.lockById(walletId);
    locked.resolve();
    await hold.promise;
  });
  await locked.promise;
  return {
    async release() {
      hold.resolve();
      await holder;
    },
  };
}

async function insertBet(transactions: WagerTransactionRepository, wallet: WalletView, amount: string) {
  const externalTransactionId = `ext-${crypto.randomUUID()}`;
  const bet = WagerTransaction.create({
    id: context.ids.next(),
    provider: { providerId: "provider-a", externalTransactionId },
    idempotencyKey: `provider-a:${externalTransactionId}`,
    payloadHash: "hash",
    walletId: wallet.id,
    playerId: wallet.playerId,
    game: { roundId: "round-1", gameId: "game-1" },
    kind: WagerTransactionKind.Bet,
    money: brl(amount),
    referenceExternalTransactionId: undefined,
    createdAt: context.clock.now(),
  });
  await transactions.insert(bet);
  return bet.id;
}

describe("MikroOrmUnitOfWork e repositórios", () => {
  test("grava e relê a wallet com valor exato, além da precisão de float", async () => {
    const view = await openWith("123456789012345678.99");

    const wallet = await context.unitOfWork.run(({ wallets }) => wallets.findById(view.id));

    expect(wallet?.balance.toJSON()).toEqual({ amount: "123456789012345678.99", currency: "BRL" });
    expect(wallet?.version).toBe(1);
    await expectWalletMatchesLedger(context.sql, view.id);
  });

  test("erro dentro do trabalho desfaz tudo o que foi gravado", async () => {
    const playerId = newPlayer();
    const failure = new Error("falha no meio do caso de uso");
    const { wallet } = Wallet.open({
      id: context.ids.next(),
      playerId,
      initialBalance: brl("0"),
      at: context.clock.now(),
      opening: { transactionId: context.ids.next(), entryId: context.ids.next() },
    });

    const attempt = context.unitOfWork.run(async ({ wallets }) => {
      await wallets.insert(wallet, undefined);
      throw failure;
    });

    await expect(attempt).rejects.toBe(failure);
    const [row] = await context.sql`select count(*)::int as count from wallets where player_id = ${playerId}`;
    expect(row.count).toBe(0);
  });

  test("lock da wallet: a segunda transação espera e, estourado o lock_timeout, vira falha transitória", async () => {
    const view = await openWith("10.00");
    const lock = await holdWalletLock(view.id);
    const shortTimeout = new MikroOrmUnitOfWork(context.orm, 200);

    const startedAt = performance.now();
    await expect(shortTimeout.run(({ wallets }) => wallets.lockById(view.id))).rejects.toBeInstanceOf(
      TransientFailureError,
    );
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(150);

    await lock.release();
  });

  test("o lock é por wallet: outra wallet não espera", async () => {
    const locked = await openWith("10.00");
    const free = await openWith("10.00");
    const lock = await holdWalletLock(locked.id);
    const shortTimeout = new MikroOrmUnitOfWork(context.orm, 200);

    const other = await shortTimeout.run(({ wallets }) => wallets.lockById(free.id));

    expect(other?.id).toBe(free.id);
    await lock.release();
  });

  test("update com versão desatualizada é rejeitado e não grava nada", async () => {
    const view = await openWith("100.00");
    const load = async () => (await context.unitOfWork.run(({ wallets }) => wallets.findById(view.id)))!;
    const stale = await load();
    const fresh = await load();

    await context.unitOfWork.run(async ({ wallets, transactions }) => {
      const transactionId = await insertBet(transactions, view, "10.00");
      const entry = fresh.debit({ entryId: context.ids.next(), transactionId, money: brl("10.00"), at: context.clock.now() });
      await wallets.update(fresh, entry);
    });

    const staleAttempt = context.unitOfWork.run(async ({ wallets, transactions }) => {
      const transactionId = await insertBet(transactions, view, "20.00");
      const entry = stale.debit({ entryId: context.ids.next(), transactionId, money: brl("20.00"), at: context.clock.now() });
      await wallets.update(stale, entry);
    });

    await expect(staleAttempt).rejects.toBeInstanceOf(WalletVersionConflictError);
    const current = await load();
    expect(current.balance.toJSON().amount).toBe("90.00");
    expect(current.version).toBe(2);
    await expectWalletMatchesLedger(context.sql, view.id);
  });
});
