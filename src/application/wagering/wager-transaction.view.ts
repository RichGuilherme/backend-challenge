import type { MoneyProps } from "../../domain/shared/money/money";
import type { FailureCode } from "../../domain/wagering/failure-code";
import type { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import type { Wallet } from "../../domain/wallet/wallet";

export interface SubmissionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  failureCode: FailureCode | undefined;
  idempotentReplay: boolean;
}

export interface WagerTransactionView {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId: string | undefined;
  referenceTransactionId: string | undefined;
  status: WagerTransactionStatus;
  failureCode: FailureCode | undefined;
  observedBalance: MoneyProps | undefined;
  createdAt: string;
  processedAt: string | undefined;
}

export function toSubmissionResult(
  transaction: WagerTransaction,
  wallet: Wallet,
  idempotentReplay: boolean,
): SubmissionResult {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: (transaction.observedBalance ?? wallet.balance).toJSON(),
    failureCode: transaction.failureCode,
    idempotentReplay,
  };
}

export function toWagerTransactionView(transaction: WagerTransaction): WagerTransactionView {
  return {
    id: transaction.id,
    providerId: transaction.provider.providerId,
    externalTransactionId: transaction.provider.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.game.roundId,
    gameId: transaction.game.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    status: transaction.status,
    failureCode: transaction.failureCode,
    observedBalance: transaction.observedBalance?.toJSON(),
    createdAt: transaction.createdAt.toISOString(),
    processedAt: transaction.processedAt?.toISOString(),
  };
}
