import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import type { WalletView } from "../../../src/application/wallet/wallet.view";
import { WagerTransactionKind } from "../../../src/domain/wagering/wager-transaction-kind";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { outboxByPartition } from "../../support/outbox";

let context: TestContext;
let openWallet: OpenWalletUseCase;
let submit: SubmitWagerTransactionUseCase;

beforeAll(async () => {
  context = await createTestContext();
  openWallet = new OpenWalletUseCase(context.unitOfWork, context.ids, context.clock);
  submit = new SubmitWagerTransactionUseCase(context.unitOfWork, context.ids, context.clock);
});

afterAll(() => context?.close());

const open = (amount: string): Promise<WalletView> =>
  openWallet.execute({
    playerId: `player-${crypto.randomUUID()}`,
    initialBalance: { amount, currency: "BRL" },
    correlationId: "corr-open",
  });

const eventTypesOf = async (walletId: string) =>
  (await outboxByPartition(context.sql, walletId)).map((row) => row.event_type);

describe("eventos enfileirados na outbox, na mesma transação", () => {
  test("abertura com saldo: só WalletBalanceChanged, já com o envelope do README", async () => {
    const wallet = await open("100.00");

    const [row, ...rest] = await outboxByPartition(context.sql, wallet.id);

    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      event_type: "WalletBalanceChanged",
      aggregate_id: wallet.id,
      attempts: 0,
      published_at: null,
    });
    expect(row?.payload).toMatchObject({
      eventId: row?.id,
      eventType: "WalletBalanceChanged",
      correlationId: "corr-open",
      version: 1,
      data: {
        walletId: wallet.id,
        direction: "CREDIT",
        balanceAfter: { amount: "100.00", currency: "BRL" },
        walletVersion: 1,
      },
    });
  });

  test("abertura com saldo zero: nenhum evento", async () => {
    const wallet = await open("0");
    expect(await eventTypesOf(wallet.id)).toEqual([]);
  });

  test("BET processada: WagerTransactionProcessed e WalletBalanceChanged", async () => {
    const wallet = await open("100.00");
    await submit.execute(submitCommand(wallet.id, wallet.playerId));
    expect(await eventTypesOf(wallet.id)).toEqual([
      "WalletBalanceChanged",
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
    ]);
  });

  test("LOSS: WagerTransactionProcessed sem WalletBalanceChanged", async () => {
    const wallet = await open("100.00");
    await submit.execute(submitCommand(wallet.id, wallet.playerId, { kind: WagerTransactionKind.Loss }));
    expect(await eventTypesOf(wallet.id)).toEqual(["WalletBalanceChanged", "WagerTransactionProcessed"]);
  });

  test("rejeição: WagerTransactionRejected", async () => {
    const wallet = await open("1.00");
    await submit.execute(submitCommand(wallet.id, wallet.playerId));
    const rows = await outboxByPartition(context.sql, wallet.id);
    expect(rows.map((row) => row.event_type)).toEqual(["WalletBalanceChanged", "WagerTransactionRejected"]);
    expect(rows[1]?.payload.data).toMatchObject({ failureCode: "INSUFFICIENT_FUNDS" });
  });

  test("referência ausente: WagerTransactionPendingReference", async () => {
    const wallet = await open("100.00");
    await submit.execute(
      submitCommand(wallet.id, wallet.playerId, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "ainda-nao-chegou",
      }),
    );
    expect(await eventTypesOf(wallet.id)).toEqual(["WalletBalanceChanged", "WagerTransactionPendingReference"]);
  });

  test("replay não enfileira nada de novo", async () => {
    const wallet = await open("100.00");
    const bet = submitCommand(wallet.id, wallet.playerId);
    await submit.execute(bet);
    const before = await eventTypesOf(wallet.id);

    await submit.execute(bet);
    await submit.execute(bet);

    expect(await eventTypesOf(wallet.id)).toEqual(before);
  });

  test("conflito de idempotência não enfileira nada", async () => {
    const wallet = await open("100.00");
    const bet = submitCommand(wallet.id, wallet.playerId);
    await submit.execute(bet);
    const before = await eventTypesOf(wallet.id);

    await expect(submit.execute({ ...bet, money: { amount: "1.00", currency: "BRL" } })).rejects.toThrow();

    expect(await eventTypesOf(wallet.id)).toEqual(before);
  });

  test("correlationId e causationId do comando chegam ao envelope", async () => {
    const wallet = await open("100.00");
    await submit.execute(
      submitCommand(wallet.id, wallet.playerId, { correlationId: "corr-bet", causationId: "msg-42" }),
    );
    const rows = await outboxByPartition(context.sql, wallet.id);
    const betEvents = rows.filter((row) => row.payload.correlationId === "corr-bet");
    expect(betEvents).toHaveLength(2);
    for (const row of betEvents) expect(row.payload.causationId).toBe("msg-42");
  });
});
