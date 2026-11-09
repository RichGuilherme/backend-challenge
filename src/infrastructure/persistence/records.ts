import { defineEntity, p, type InferEntity } from "@mikro-orm/core";

const money = () => p.decimal().precision(20).scale(2);

export const WalletRecord = defineEntity({
  name: "WalletRecord",
  tableName: "wallets",
  properties: {
    id: p.uuid().primary(),
    playerId: p.string(),
    currency: p.string(),
    balance: money(),
    version: p.integer(),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  },
});

export const WagerTransactionRecord = defineEntity({
  name: "WagerTransactionRecord",
  tableName: "wager_transactions",
  properties: {
    id: p.uuid().primary(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    idempotencyKey: p.string(),
    payloadHash: p.string(),
    walletId: p.uuid(),
    playerId: p.string(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.string(),
    amount: money(),
    currency: p.string(),
    referenceExternalTransactionId: p.string().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    status: p.string(),
    failureCode: p.string().nullable(),
    observedBalance: money().nullable(),
    processedAt: p.datetime().nullable(),
    createdAt: p.datetime(),
  },
});

export const WalletLedgerEntryRecord = defineEntity({
  name: "WalletLedgerEntryRecord",
  tableName: "wallet_ledger_entries",
  properties: {
    id: p.uuid().primary(),
    walletId: p.uuid(),
    transactionId: p.uuid(),
    walletVersion: p.integer(),
    direction: p.string(),
    amount: money(),
    balanceBefore: money(),
    balanceAfter: money(),
    createdAt: p.datetime(),
  },
});

export type WalletRow = InferEntity<typeof WalletRecord>;
export type WagerTransactionRow = InferEntity<typeof WagerTransactionRecord>;
export type WalletLedgerEntryRow = InferEntity<typeof WalletLedgerEntryRecord>;

export const persistenceRecords = [WalletRecord, WagerTransactionRecord, WalletLedgerEntryRecord];
