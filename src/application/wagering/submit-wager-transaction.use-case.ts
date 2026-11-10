import { Money } from "../../domain/shared/money/money";
import { WagerSettlement } from "../../domain/wagering/wager-settlement";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { DuplicateWagerTransactionError } from "../../domain/wagering/wager-transaction.errors";
import type { Wallet } from "../../domain/wallet/wallet";
import { eventContextFactory, type EventTrace } from "../messaging/event-trace";
import type { RandomSource } from "../messaging/full-jitter";
import { outboxMessagesForSettlement } from "../messaging/settlement-events";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import { NO_OBSERVABILITY, type Observability } from "../ports/observability";
import type { TransactionScope, UnitOfWork } from "../ports/unit-of-work";
import { WalletNotFoundError, WalletPlayerMismatchError } from "../wallet/wallet.errors";
import { DEFAULT_PENDING_REFERENCE_POLICY, PendingReference, type PendingReferencePolicy } from "./pending-reference";
import { computePayloadHash, type WagerTransactionPayload } from "./payload-hash";
import { toSubmissionResult, type SubmissionResult } from "./wager-transaction.view";
import { IdempotencyConflictError } from "./wagering.errors";

export interface SubmitWagerTransactionCommand extends WagerTransactionPayload, EventTrace {
  idempotencyKey: string;
  kind: WagerTransactionKind;
}

export interface SubmitOptions {
  withinTransaction?: (scope: TransactionScope, result: SubmissionResult) => Promise<void>;
}

export class SubmitWagerTransactionUseCase {
  private readonly settlement = new WagerSettlement();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly pendingReferencePolicy: PendingReferencePolicy = DEFAULT_PENDING_REFERENCE_POLICY,
    private readonly random: RandomSource = Math.random,
    private readonly observability: Observability = NO_OBSERVABILITY,
  ) {}

  async execute(command: SubmitWagerTransactionCommand, options: SubmitOptions = {}): Promise<SubmissionResult> {
    const result = await this.submitOrReplay(command, options);
    this.observe(command, result);
    return result;
  }

  private async submitOrReplay(
    command: SubmitWagerTransactionCommand,
    options: SubmitOptions,
  ): Promise<SubmissionResult> {
    const payloadHash = computePayloadHash(command);
    try {
      return await this.runWith(options, (scope) => this.submit(scope, command, payloadHash));
    } catch (error) {
      if (!(error instanceof DuplicateWagerTransactionError)) throw error;
      return this.runWith(options, (scope) => this.replayAfterRace(scope, command, payloadHash));
    }
  }

  private observe(command: SubmitWagerTransactionCommand, result: SubmissionResult): void {
    const { metrics, logger } = this.observability;
    if (result.idempotentReplay) metrics.idempotentReplay();
    else metrics.transactionSettled(command.kind, result.status);
    logger.info("transação submetida", {
      correlationId: command.correlationId,
      messageId: command.causationId,
      transactionId: result.transactionId,
      walletId: command.walletId,
      providerId: command.providerId,
      kind: command.kind,
      status: result.status,
      failureCode: result.failureCode,
      idempotentReplay: result.idempotentReplay,
    });
  }

  private runWith(
    options: SubmitOptions,
    work: (scope: TransactionScope) => Promise<SubmissionResult>,
  ): Promise<SubmissionResult> {
    return this.unitOfWork.run(async (scope) => {
      const result = await work(scope);
      await options.withinTransaction?.(scope, result);
      return result;
    });
  }

  private async submit(
    scope: TransactionScope,
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmissionResult> {
    const wallet = await this.lockWalletOf(scope, command);
    const existing = await this.findExisting(scope, command, payloadHash);
    if (existing) return toSubmissionResult(existing, wallet, true);

    const transaction = this.createTransaction(command, payloadHash);
    const reference = await this.resolveReference(scope, transaction);
    const at = this.clock.now();
    const result = this.settlement.settle({
      transaction,
      wallet,
      reference,
      referenceAlreadyReversed: reference ? await scope.transactions.hasProcessedReversalOf(reference.id) : false,
      entryId: this.ids.next(),
      at,
    });
    const ledgerEntry = result.status === WagerTransactionStatus.Processed ? result.ledgerEntry : undefined;

    await scope.transactions.insert(transaction);
    if (ledgerEntry) await scope.wallets.update(wallet, ledgerEntry);
    if (result.status === WagerTransactionStatus.PendingReference) {
      await scope.pendingReferences.add(
        PendingReference.schedule(transaction.id, at, this.pendingReferencePolicy, this.random),
      );
    }
    await scope.outbox.add(
      outboxMessagesForSettlement(transaction, wallet, ledgerEntry, eventContextFactory(command, this.ids, at)),
    );
    return toSubmissionResult(transaction, wallet, false);
  }

  private async replayAfterRace(
    scope: TransactionScope,
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<SubmissionResult> {
    const wallet = await this.lockWalletOf(scope, command);
    const existing = await this.findExisting(scope, command, payloadHash);
    if (!existing) throw new IdempotencyConflictError(command.idempotencyKey, "KEY_MISMATCH");
    return toSubmissionResult(existing, wallet, true);
  }

  private async lockWalletOf(scope: TransactionScope, command: SubmitWagerTransactionCommand): Promise<Wallet> {
    const wallet = await scope.wallets.lockById(command.walletId);
    if (!wallet) throw new WalletNotFoundError(command.walletId);
    if (wallet.playerId !== command.playerId) throw new WalletPlayerMismatchError(command.walletId, command.playerId);
    return wallet;
  }

  private async findExisting(
    scope: TransactionScope,
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
  ): Promise<WagerTransaction | undefined> {
    const byKey = await scope.transactions.findByIdempotencyKey(command.idempotencyKey);
    if (byKey) {
      if (!byKey.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(command.idempotencyKey, "PAYLOAD_MISMATCH");
      }
      return byKey;
    }
    const byProviderReference = await scope.transactions.findByProviderReference(
      command.providerId,
      command.externalTransactionId,
    );
    if (byProviderReference) throw new IdempotencyConflictError(command.idempotencyKey, "KEY_MISMATCH");
    return undefined;
  }

  private createTransaction(command: SubmitWagerTransactionCommand, payloadHash: string): WagerTransaction {
    return WagerTransaction.create({
      id: this.ids.next(),
      provider: { providerId: command.providerId, externalTransactionId: command.externalTransactionId },
      idempotencyKey: command.idempotencyKey,
      payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      game: { roundId: command.roundId, gameId: command.gameId },
      kind: command.kind,
      money: Money.from(command.money),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      createdAt: this.clock.now(),
    });
  }

  private resolveReference(
    scope: TransactionScope,
    transaction: WagerTransaction,
  ): Promise<WagerTransaction | undefined> {
    const referenceId = transaction.requiresReference() ? transaction.referenceExternalTransactionId : undefined;
    if (!referenceId) return Promise.resolve(undefined);
    return scope.transactions.findByProviderReference(transaction.provider.providerId, referenceId);
  }
}
