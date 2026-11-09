import { Money } from "../../domain/shared/money/money";
import type { FailureCode } from "../../domain/wagering/failure-code";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wagering/wager-transaction-kind";
import type { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { WagerTransactionRow, WalletLedgerEntryRow, WalletRow } from "./records";

const moneyOf = (amount: string, currency: string) => Money.from({ amount, currency });
const optional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

export function toWallet(row: WalletRow): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    currency: row.currency,
    balance: moneyOf(row.balance, row.currency),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toWalletRow(wallet: Wallet): WalletRow {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.toJSON().amount,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function toLedgerEntryRow(entry: WalletLedgerEntry): WalletLedgerEntryRow {
  return {
    id: entry.id,
    walletId: entry.walletId,
    transactionId: entry.transactionId,
    walletVersion: entry.walletVersion,
    direction: entry.direction,
    amount: entry.money.toJSON().amount,
    balanceBefore: entry.balanceBefore.toJSON().amount,
    balanceAfter: entry.balanceAfter.toJSON().amount,
    createdAt: entry.createdAt,
  };
}

export function toWagerTransaction(row: WagerTransactionRow): WagerTransaction {
  const observedBalance = optional(row.observedBalance);
  return WagerTransaction.rehydrate({
    id: row.id,
    provider: { providerId: row.providerId, externalTransactionId: row.externalTransactionId },
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    walletId: row.walletId,
    playerId: row.playerId,
    game: { roundId: row.roundId, gameId: row.gameId },
    kind: row.kind as WagerTransactionKind,
    money: moneyOf(row.amount, row.currency),
    referenceExternalTransactionId: optional(row.referenceExternalTransactionId),
    createdAt: row.createdAt,
    outcome: {
      status: row.status as WagerTransactionStatus,
      referenceTransactionId: optional(row.referenceTransactionId),
      failureCode: optional(row.failureCode) as FailureCode | undefined,
      observedBalance: observedBalance === undefined ? undefined : moneyOf(observedBalance, row.currency),
      processedAt: optional(row.processedAt),
    },
  });
}

export function toWagerTransactionRow(transaction: WagerTransaction): WagerTransactionRow {
  return {
    id: transaction.id,
    providerId: transaction.provider.providerId,
    externalTransactionId: transaction.provider.externalTransactionId,
    idempotencyKey: transaction.idempotencyKey,
    payloadHash: transaction.payloadHash,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.game.roundId,
    gameId: transaction.game.gameId,
    kind: transaction.kind,
    amount: transaction.money.toJSON().amount,
    currency: transaction.money.currency,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
    referenceTransactionId: transaction.referenceTransactionId ?? null,
    status: transaction.status,
    failureCode: transaction.failureCode ?? null,
    observedBalance: transaction.observedBalance?.toJSON().amount ?? null,
    processedAt: transaction.processedAt ?? null,
    createdAt: transaction.createdAt,
  };
}
