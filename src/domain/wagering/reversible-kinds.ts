import { WagerTransactionKind } from "./wager-transaction-kind";

export const REVERSIBLE_KINDS_BY_REVERSAL: ReadonlyMap<
  WagerTransactionKind,
  ReadonlySet<WagerTransactionKind>
> = new Map([
  [WagerTransactionKind.Refund, new Set([WagerTransactionKind.Bet])],
  [
    WagerTransactionKind.Rollback,
    new Set([WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund]),
  ],
]);
