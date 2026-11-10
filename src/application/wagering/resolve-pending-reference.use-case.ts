import { FailureCode } from "../../domain/wagering/failure-code";
import { WagerSettlement } from "../../domain/wagering/wager-settlement";
import type { WagerTransaction } from "../../domain/wagering/wager-transaction";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import type { Wallet } from "../../domain/wallet/wallet";
import { eventContextFactory } from "../messaging/event-trace";
import type { RandomSource } from "../messaging/full-jitter";
import { outboxMessagesForSettlement } from "../messaging/settlement-events";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import { NO_OBSERVABILITY, type Observability } from "../ports/observability";
import type { TransactionScope, UnitOfWork } from "../ports/unit-of-work";
import {
  DEFAULT_PENDING_REFERENCE_POLICY,
  type PendingReference,
  type PendingReferencePolicy,
} from "./pending-reference";

export type ResolutionOutcome = "PROCESSED" | "REJECTED" | "RESCHEDULED";

interface Resolution {
  outcome: ResolutionOutcome;
  transaction: WagerTransaction;
}

export class ResolvePendingReferenceUseCase {
  private readonly settlement = new WagerSettlement();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly policy: PendingReferencePolicy = DEFAULT_PENDING_REFERENCE_POLICY,
    private readonly random: RandomSource = Math.random,
    private readonly observability: Observability = NO_OBSERVABILITY,
  ) {}

  async execute(): Promise<ResolutionOutcome | undefined> {
    const startedAt = performance.now();
    const resolved = await this.unitOfWork.run(async (scope) => {
      const now = this.clock.now();
      const pending = await scope.pendingReferences.claimNextDue(now);
      if (!pending) return undefined;
      return this.resolve(scope, pending, now);
    });
    if (!resolved) return undefined;
    this.observe(resolved, (performance.now() - startedAt) / 1_000);
    return resolved.outcome;
  }

  private observe({ outcome, transaction }: Resolution, seconds: number): void {
    const { metrics, logger } = this.observability;
    if (outcome !== "RESCHEDULED") metrics.transactionSettled(transaction.kind, transaction.status);
    metrics.processingDuration("reference-worker", seconds);
    logger.info("referência pendente resolvida", {
      correlationId: transaction.id,
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.provider.providerId,
      kind: transaction.kind,
      status: transaction.status,
      failureCode: transaction.failureCode,
      outcome,
    });
  }

  private async resolve(scope: TransactionScope, pending: PendingReference, now: Date): Promise<Resolution> {
    const transaction = await this.load(scope, pending.transactionId);
    const wallet = await this.lockWallet(scope, transaction);
    const reference = await scope.transactions.findByProviderReference(
      transaction.provider.providerId,
      transaction.referenceExternalTransactionId ?? "",
    );
    const result = this.settlement.settle({
      transaction,
      wallet,
      reference,
      referenceAlreadyReversed: reference ? await scope.transactions.hasProcessedReversalOf(reference.id) : false,
      entryId: this.ids.next(),
      at: now,
    });

    if (result.status === WagerTransactionStatus.PendingReference) {
      if (!pending.isExpired(now)) {
        pending.reschedule(now, this.policy, this.random);
        await scope.pendingReferences.save(pending);
        return { outcome: "RESCHEDULED", transaction };
      }
      transaction.reject({ code: FailureCode.ReferenceNotFound, at: now, observedBalance: wallet.balance });
    }

    const ledgerEntry = result.status === WagerTransactionStatus.Processed ? result.ledgerEntry : undefined;
    await scope.transactions.update(transaction);
    if (ledgerEntry) await scope.wallets.update(wallet, ledgerEntry);
    await scope.pendingReferences.remove(transaction.id);
    await scope.outbox.add(
      outboxMessagesForSettlement(
        transaction,
        wallet,
        ledgerEntry,
        eventContextFactory({ correlationId: transaction.id }, this.ids, now),
      ),
    );
    const outcome = transaction.status === WagerTransactionStatus.Processed ? "PROCESSED" : "REJECTED";
    return { outcome, transaction };
  }

  private async load(scope: TransactionScope, transactionId: string): Promise<WagerTransaction> {
    const transaction = await scope.transactions.findById(transactionId);
    if (!transaction) throw new Error(`Pendência aponta para transação inexistente: ${transactionId}`);
    return transaction;
  }

  private async lockWallet(scope: TransactionScope, transaction: WagerTransaction): Promise<Wallet> {
    const wallet = await scope.wallets.lockById(transaction.walletId);
    if (!wallet) throw new Error(`Transação ${transaction.id} aponta para wallet inexistente: ${transaction.walletId}`);
    return wallet;
  }
}
