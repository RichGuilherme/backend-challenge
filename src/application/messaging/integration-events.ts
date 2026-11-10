import type { MoneyProps } from "../../domain/shared/money/money";
import type { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { LedgerDirection } from "../../domain/wallet/ledger-direction";
import type { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { IntegrationEvent } from "./integration-event";

export interface EventContext {
  eventId: string;
  correlationId: string;
  causationId: string | undefined;
  occurredAt: Date;
}

const envelopeOf = <T>(aggregateId: string, data: T, context: EventContext) => ({
  eventId: context.eventId,
  aggregateId,
  correlationId: context.correlationId,
  causationId: context.causationId,
  occurredAt: context.occurredAt,
  data,
});

abstract class WalletScopedEvent<T extends { walletId: string }> extends IntegrationEvent<T> {
  get partitionKey(): string {
    return this.data.walletId;
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends WalletScopedEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  static from(wallet: Wallet, entry: WalletLedgerEntry, context: EventContext): WalletBalanceChanged {
    return new WalletBalanceChanged(
      envelopeOf(
        wallet.id,
        {
          walletId: wallet.id,
          transactionId: entry.transactionId,
          direction: entry.direction,
          money: entry.money.toJSON(),
          balanceBefore: entry.balanceBefore.toJSON(),
          balanceAfter: entry.balanceAfter.toJSON(),
          walletVersion: entry.walletVersion,
        },
        context,
      ),
    );
  }
}

export interface WagerTransactionData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
}

function transactionData(transaction: WagerTransaction): WagerTransactionData {
  return {
    transactionId: transaction.id,
    providerId: transaction.provider.providerId,
    externalTransactionId: transaction.provider.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.game.roundId,
    gameId: transaction.game.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
  };
}

function requireOutcome<T>(value: T | undefined, field: string, transaction: WagerTransaction): T {
  if (value === undefined) {
    throw new Error(`Transação ${transaction.id} em ${transaction.status} sem ${field} para o evento`);
  }
  return value;
}

export interface WagerTransactionProcessedData extends WagerTransactionData {
  observedBalance: MoneyProps;
  referenceTransactionId: string | null;
  processedAt: string;
}

export class WagerTransactionProcessed extends WalletScopedEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed(
      envelopeOf(
        transaction.id,
        {
          ...transactionData(transaction),
          observedBalance: requireOutcome(transaction.observedBalance, "observedBalance", transaction).toJSON(),
          referenceTransactionId: transaction.referenceTransactionId ?? null,
          processedAt: requireOutcome(transaction.processedAt, "processedAt", transaction).toISOString(),
        },
        context,
      ),
    );
  }
}

export interface WagerTransactionRejectedData extends WagerTransactionData {
  failureCode: string;
  observedBalance: MoneyProps;
  referenceTransactionId: string | null;
  processedAt: string;
}

export class WagerTransactionRejected extends WalletScopedEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionRejected {
    return new WagerTransactionRejected(
      envelopeOf(
        transaction.id,
        {
          ...transactionData(transaction),
          failureCode: requireOutcome(transaction.failureCode, "failureCode", transaction),
          observedBalance: requireOutcome(transaction.observedBalance, "observedBalance", transaction).toJSON(),
          referenceTransactionId: transaction.referenceTransactionId ?? null,
          processedAt: requireOutcome(transaction.processedAt, "processedAt", transaction).toISOString(),
        },
        context,
      ),
    );
  }
}

export interface WagerTransactionPendingReferenceData extends WagerTransactionData {
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends WalletScopedEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(
      envelopeOf(
        transaction.id,
        {
          ...transactionData(transaction),
          referenceExternalTransactionId: requireOutcome(
            transaction.referenceExternalTransactionId,
            "referenceExternalTransactionId",
            transaction,
          ),
        },
        context,
      ),
    );
  }
}
