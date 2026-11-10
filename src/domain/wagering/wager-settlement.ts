import { LedgerDirection } from "../wallet/ledger-direction";
import type { Wallet, WalletMovement } from "../wallet/wallet";
import type { WalletLedgerEntry } from "../wallet/wallet-ledger-entry";
import { InsufficientFundsError } from "../wallet/wallet.errors";
import { FailureCode } from "./failure-code";
import { ReversalPolicy } from "./reversal-policy";
import type { WagerTransaction } from "./wager-transaction";
import { WagerTransactionKind } from "./wager-transaction-kind";
import { WagerTransactionStatus } from "./wager-transaction-status";
import { WagerRuleViolationError } from "./wager-transaction.errors";
import { InvalidSettlementError } from "./wager-settlement.errors";

export interface SettlementInput {
  transaction: WagerTransaction;
  wallet: Wallet;
  reference: WagerTransaction | undefined;
  referenceAlreadyReversed: boolean;
  entryId: string;
  at: Date;
}

export type SettlementResult =
  | { status: WagerTransactionStatus.Processed; ledgerEntry: WalletLedgerEntry | undefined }
  | { status: WagerTransactionStatus.Rejected; failureCode: FailureCode }
  | { status: WagerTransactionStatus.PendingReference };

export class WagerSettlement {
  constructor(private readonly reversalPolicy: ReversalPolicy = new ReversalPolicy()) {}

  settle(input: SettlementInput): SettlementResult {
    this.assertSettleable(input);
    const { transaction, wallet, reference } = input;

    if (transaction.money.currency !== wallet.currency) {
      return this.reject(input, FailureCode.CurrencyMismatch);
    }
    if (transaction.requiresReference()) {
      if (!reference?.isTerminal()) return this.awaitReference(transaction);
      const violation = this.findReversalViolation(input, reference);
      if (violation) return this.reject(input, violation, reference.id);
    }
    if (!transaction.affectsBalance()) return this.process(input, undefined);

    return this.moveBalance(input);
  }

  private moveBalance(input: SettlementInput): SettlementResult {
    const { transaction, wallet, reference } = input;
    const movement: WalletMovement = {
      entryId: input.entryId,
      transactionId: transaction.id,
      money: transaction.money,
      at: input.at,
    };

    try {
      const entry =
        transaction.ledgerDirectionFor(reference) === LedgerDirection.Debit
          ? wallet.debit(movement)
          : wallet.credit(movement);
      return this.process(input, entry);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) throw error;
      return this.reject(input, this.insufficientFundsCodeFor(transaction), this.reversalReferenceId(input));
    }
  }

  private findReversalViolation(input: SettlementInput, reference: WagerTransaction): FailureCode | undefined {
    try {
      this.reversalPolicy.validate(input.transaction, reference);
    } catch (error) {
      if (error instanceof WagerRuleViolationError) return error.failureCode;
      throw error;
    }
    return input.referenceAlreadyReversed ? FailureCode.ReferenceAlreadyReversed : undefined;
  }

  private insufficientFundsCodeFor(transaction: WagerTransaction): FailureCode {
    return transaction.kind === WagerTransactionKind.Bet
      ? FailureCode.InsufficientFunds
      : FailureCode.ReversalInsufficientFunds;
  }

  private process(input: SettlementInput, ledgerEntry: WalletLedgerEntry | undefined): SettlementResult {
    input.transaction.markProcessed({
      at: input.at,
      observedBalance: input.wallet.balance,
      referenceTransactionId: this.reversalReferenceId(input),
    });
    return { status: WagerTransactionStatus.Processed, ledgerEntry };
  }

  private reject(input: SettlementInput, failureCode: FailureCode, referenceTransactionId?: string): SettlementResult {
    input.transaction.reject({
      code: failureCode,
      at: input.at,
      observedBalance: input.wallet.balance,
      referenceTransactionId,
    });
    return { status: WagerTransactionStatus.Rejected, failureCode };
  }

  private awaitReference(transaction: WagerTransaction): SettlementResult {
    transaction.markPendingReference();
    return { status: WagerTransactionStatus.PendingReference };
  }

  private reversalReferenceId(input: SettlementInput): string | undefined {
    return input.transaction.requiresReference() ? input.reference?.id : undefined;
  }

  private assertSettleable({ transaction, wallet }: SettlementInput): void {
    if (transaction.isTerminal()) {
      throw new InvalidSettlementError(`Transação ${transaction.id} já está ${transaction.status}`);
    }
    if (transaction.walletId !== wallet.id || transaction.playerId !== wallet.playerId) {
      throw new InvalidSettlementError(
        `Transação ${transaction.id} não pertence à wallet ${wallet.id} do player ${wallet.playerId}`,
      );
    }
  }
}
