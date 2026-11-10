import { FailureCode } from "./failure-code";
import { REVERSIBLE_KINDS_BY_REVERSAL } from "./reversible-kinds";
import type { WagerTransaction } from "./wager-transaction";
import { WagerTransactionStatus } from "./wager-transaction-status";
import { InvalidWagerTransactionError, WagerRuleViolationError } from "./wager-transaction.errors";

export class ReversalPolicy {
  validate(reversal: WagerTransaction, reference: WagerTransaction): void {
    this.assertIsReversalTargeting(reversal, reference);
    this.assertSameContext(reversal, reference);
    this.assertCanReverseKind(reversal, reference);
    this.assertReferenceProcessed(reference);
    this.assertSameAmount(reversal, reference);
  }

  private assertIsReversalTargeting(reversal: WagerTransaction, reference: WagerTransaction): void {
    if (!reversal.requiresReference()) {
      throw new InvalidWagerTransactionError(`${reversal.kind} não reverte transações`);
    }
    if (reference.provider.externalTransactionId !== reversal.referenceExternalTransactionId) {
      throw new InvalidWagerTransactionError(
        `Referência ${reference.provider.externalTransactionId} não é a informada (${reversal.referenceExternalTransactionId})`,
      );
    }
    if (!reference.isTerminal()) {
      throw new InvalidWagerTransactionError(`Referência ${reference.id} ainda não está em estado terminal`);
    }
  }

  private assertSameContext(reversal: WagerTransaction, reference: WagerTransaction): void {
    const sameContext =
      reference.provider.providerId === reversal.provider.providerId &&
      reference.playerId === reversal.playerId &&
      reference.walletId === reversal.walletId &&
      reference.game.roundId === reversal.game.roundId &&
      reference.money.currency === reversal.money.currency;

    if (!sameContext) {
      throw new WagerRuleViolationError(
        FailureCode.ReferenceMismatch,
        `Referência ${reference.id} é de outro provider, player, wallet, moeda ou rodada`,
      );
    }
  }

  private assertCanReverseKind(reversal: WagerTransaction, reference: WagerTransaction): void {
    if (!REVERSIBLE_KINDS_BY_REVERSAL.get(reversal.kind)?.has(reference.kind)) {
      throw new WagerRuleViolationError(
        FailureCode.InvalidReferenceKind,
        `${reversal.kind} não reverte ${reference.kind}`,
      );
    }
  }

  private assertReferenceProcessed(reference: WagerTransaction): void {
    if (reference.status !== WagerTransactionStatus.Processed) {
      throw new WagerRuleViolationError(
        FailureCode.ReferenceNotProcessed,
        `Referência ${reference.id} está ${reference.status}`,
      );
    }
  }

  private assertSameAmount(reversal: WagerTransaction, reference: WagerTransaction): void {
    if (!reference.money.equals(reversal.money)) {
      throw new WagerRuleViolationError(
        FailureCode.ReversalAmountMismatch,
        `Valor ${reversal.money} difere da referência ${reference.money}`,
      );
    }
  }
}
