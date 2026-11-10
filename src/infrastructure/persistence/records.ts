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

export const OutboxMessageRecord = defineEntity({
  name: "OutboxMessageRecord",
  tableName: "outbox_messages",
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.string(),
    partitionKey: p.string(),
    eventType: p.string(),
    payload: p.json<Record<string, unknown>>(),
    occurredAt: p.datetime(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime(),
    publishedAt: p.datetime().nullable(),
  },
});

export const PendingReferenceRecord = defineEntity({
  name: "PendingReferenceRecord",
  tableName: "pending_references",
  properties: {
    transactionId: p.uuid().primary(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime(),
    expiresAt: p.datetime(),
  },
});

export const InboxMessageRecord = defineEntity({
  name: "InboxMessageRecord",
  tableName: "inbox_messages",
  properties: {
    consumerName: p.string().primary(),
    messageId: p.string().primary(),
    payloadHash: p.string(),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export type WalletRow = InferEntity<typeof WalletRecord>;
export type WagerTransactionRow = InferEntity<typeof WagerTransactionRecord>;
export type WalletLedgerEntryRow = InferEntity<typeof WalletLedgerEntryRecord>;
export type OutboxMessageRow = InferEntity<typeof OutboxMessageRecord>;
export type PendingReferenceRow = InferEntity<typeof PendingReferenceRecord>;

export const persistenceRecords = [
  WalletRecord,
  WagerTransactionRecord,
  WalletLedgerEntryRecord,
  OutboxMessageRecord,
  PendingReferenceRecord,
  InboxMessageRecord,
];
