import { describe, expect, test } from "bun:test";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  type EventContext,
} from "../../../../src/application/messaging/integration-events";
import { LedgerDirection } from "../../../../src/domain/wallet/ledger-direction";
import { FailureCode } from "../../../../src/domain/wagering/failure-code";
import { WagerTransactionKind } from "../../../../src/domain/wagering/wager-transaction-kind";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { brl } from "../../../support/money";
import { buildWagerTransaction, externalId } from "../../../support/wagering";

const at = new Date("2026-11-09T12:00:01.000Z");
const context: EventContext = { eventId: "event-1", correlationId: "corr-1", causationId: undefined, occurredAt: at };

function openedWallet() {
  return Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: brl("100.00"),
    at,
    opening: { transactionId: "tx-opening", entryId: "entry-opening" },
  });
}

describe("eventos de integração", () => {
  test("WalletBalanceChanged: envelope do README, Money como string e versão no tipo", () => {
    const { wallet } = openedWallet();
    const entry = wallet.debit({ entryId: "entry-1", transactionId: "tx-1", money: brl("25.00"), at });

    const event = WalletBalanceChanged.from(wallet, entry, context);

    expect(event.eventType).toBe("WalletBalanceChanged");
    expect(event.version).toBe(1);
    expect(event.partitionKey).toBe("wallet-1");
    expect(event.toJSON()).toEqual({
      eventId: "event-1",
      eventType: "WalletBalanceChanged",
      aggregateId: "wallet-1",
      correlationId: "corr-1",
      occurredAt: "2026-11-09T12:00:01.000Z",
      version: 1,
      data: {
        walletId: "wallet-1",
        transactionId: "tx-1",
        direction: LedgerDirection.Debit,
        money: { amount: "25.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "75.00", currency: "BRL" },
        walletVersion: 2,
      },
    });
  });

  test("causationId aparece no envelope quando existe", () => {
    const { wallet } = openedWallet();
    const entry = wallet.credit({ entryId: "entry-1", transactionId: "tx-1", money: brl("1.00"), at });
    const event = WalletBalanceChanged.from(wallet, entry, { ...context, causationId: "msg-9" });
    expect(event.toJSON().causationId).toBe("msg-9");
  });

  test("WagerTransactionProcessed carrega o saldo observado e a referência", () => {
    const tx = buildWagerTransaction({ ...externalId("ext-1"), kind: WagerTransactionKind.Loss });
    tx.markProcessed({ at, observedBalance: brl("100.00"), referenceTransactionId: undefined });

    const json = WagerTransactionProcessed.from(tx, context).toJSON();

    expect(json).toMatchObject({ eventType: "WagerTransactionProcessed", aggregateId: tx.id, version: 1 });
    expect(json.data).toEqual({
      transactionId: tx.id,
      providerId: "provider-a",
      externalTransactionId: "ext-1",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: "LOSS",
      money: { amount: "25.00", currency: "BRL" },
      observedBalance: { amount: "100.00", currency: "BRL" },
      referenceTransactionId: null,
      processedAt: "2026-11-09T12:00:01.000Z",
    });
  });

  test("WagerTransactionRejected carrega o failureCode", () => {
    const tx = buildWagerTransaction(externalId("ext-2"));
    tx.reject({ code: FailureCode.InsufficientFunds, at, observedBalance: brl("1.00") });

    const json = WagerTransactionRejected.from(tx, context).toJSON();

    expect(json.eventType).toBe("WagerTransactionRejected");
    expect(json.data).toMatchObject({ failureCode: "INSUFFICIENT_FUNDS", observedBalance: { amount: "1.00" } });
  });

  test("WagerTransactionPendingReference carrega a referência esperada", () => {
    const tx = buildWagerTransaction({
      ...externalId("ext-3"),
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "ext-bet",
    });
    tx.markPendingReference();

    const json = WagerTransactionPendingReference.from(tx, context).toJSON();

    expect(json.eventType).toBe("WagerTransactionPendingReference");
    expect(json.data).toMatchObject({ kind: "REFUND", referenceExternalTransactionId: "ext-bet" });
  });

  test("evento é imutável e o payload é JSON estável", () => {
    const { wallet } = openedWallet();
    const entry = wallet.credit({ entryId: "entry-1", transactionId: "tx-1", money: brl("1.00"), at });
    const event = WalletBalanceChanged.from(wallet, entry, context);

    expect(Object.isFrozen(event.data)).toBe(true);
    expect(JSON.parse(JSON.stringify(event))).toEqual(event.toJSON());
  });
});
