import { Money } from "../../domain/shared/money/money";
import { WagerSettlement } from "../../domain/wagering/wager-settlement";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import type { WagerTransactionKind } from "../../domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { DuplicateWagerTransactionError } from "../../domain/wagering/wager-transaction.errors";
import type { Wallet } from "../../domain/wallet/wallet";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { TransactionScope, UnitOfWork } from "../ports/unit-of-work";
import { WalletNotFoundError, WalletPlayerMismatchError } from "../wallet/wallet.errors";
import { computePayloadHash, type WagerTransactionPayload } from "./payload-hash";
import { toSubmissionResult, type SubmissionResult } from "./wager-transaction.view";
import { IdempotencyConflictError } from "./wagering.errors";

export interface SubmitWagerTransactionCommand extends WagerTransactionPayload {
  idempotencyKey: string;
  kind: WagerTransactionKind;
}

export class SubmitWagerTransactionUseCase {
  private readonly settlement = new WagerSettlement();

  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: SubmitWagerTransactionCommand): Promise<SubmissionResult> {
    const payloadHash = computePayloadHash(command);
    try {
      return await this.unitOfWork.run((scope) => this.submit(scope, command, payloadHash));
    } catch (error) {
      if (!(error instanceof DuplicateWagerTransactionError)) throw error;
      return this.unitOfWork.run((scope) => this.replayAfterRace(scope, command, payloadHash));
    }
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
    const result = this.settlement.settle({
      transaction,
      wallet,
      reference,
      referenceAlreadyReversed: reference ? await scope.transactions.hasProcessedReversalOf(reference.id) : false,
      entryId: this.ids.next(),
      at: this.clock.now(),
    });

    await scope.transactions.insert(transaction);
    if (result.status === WagerTransactionStatus.Processed && result.ledgerEntry) {
      await scope.wallets.update(wallet, result.ledgerEntry);
    }
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
