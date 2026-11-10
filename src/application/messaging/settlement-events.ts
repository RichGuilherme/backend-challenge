import type { WagerTransaction } from "../../domain/wagering/wager-transaction";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import type { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { IntegrationEvent } from "./integration-event";
import { OutboxMessage } from "./outbox-message";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  type EventContext,
} from "./integration-events";

export function eventsForSettlement(
  transaction: WagerTransaction,
  wallet: Wallet,
  ledgerEntry: WalletLedgerEntry | undefined,
  nextContext: () => EventContext,
): IntegrationEvent<unknown>[] {
  switch (transaction.status) {
    case WagerTransactionStatus.Processed:
      return [
        WagerTransactionProcessed.from(transaction, nextContext()),
        ...(ledgerEntry ? [WalletBalanceChanged.from(wallet, ledgerEntry, nextContext())] : []),
      ];
    case WagerTransactionStatus.Rejected:
      return [WagerTransactionRejected.from(transaction, nextContext())];
    case WagerTransactionStatus.PendingReference:
      return [WagerTransactionPendingReference.from(transaction, nextContext())];
    case WagerTransactionStatus.Pending:
    case WagerTransactionStatus.Failed:
      throw new Error(`Transação ${transaction.id} em ${transaction.status} não tem eventos de liquidação`);
  }
}

export function outboxMessagesForSettlement(
  transaction: WagerTransaction,
  wallet: Wallet,
  ledgerEntry: WalletLedgerEntry | undefined,
  nextContext: () => EventContext,
): OutboxMessage[] {
  return eventsForSettlement(transaction, wallet, ledgerEntry, nextContext).map((event) =>
    OutboxMessage.enqueue(event),
  );
}
