import type { Money } from "../shared/money/money";
import { copyDate } from "../shared/copy-date";
import { LedgerDirection } from "../wallet/ledger-direction";
import { FailureCode } from "./failure-code";
import type { GameContext } from "./game-context";
import type { ProviderReference } from "./provider-reference";
import { WagerTransactionKind } from "./wager-transaction-kind";
import type { WagerTransactionOutcome } from "./wager-transaction-outcome";
import { WagerTransactionStatus } from "./wager-transaction-status";
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
  WagerRuleViolationError,
} from "./wager-transaction.errors";

export interface CreateWagerTransactionProps {
  id: string;
  provider: ProviderReference;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  game: GameContext;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  outcome: WagerTransactionOutcome;
}

export interface MarkProcessedProps {
  at: Date;
  observedBalance: Money;
  referenceTransactionId: string | undefined;
}

export interface RejectProps {
  code: FailureCode;
  at: Date;
  observedBalance: Money;
  referenceTransactionId?: string;
}

export interface FailProps {
  code: FailureCode;
  at: Date;
}

const PENDING_OUTCOME: WagerTransactionOutcome = {
  status: WagerTransactionStatus.Pending,
  referenceTransactionId: undefined,
  failureCode: undefined,
  observedBalance: undefined,
  processedAt: undefined,
};

const TERMINAL_STATUSES: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

const REVERSIBLE_KINDS_BY_REVERSAL: ReadonlyMap<WagerTransactionKind, ReadonlySet<WagerTransactionKind>> = new Map([
  [WagerTransactionKind.Refund, new Set([WagerTransactionKind.Bet])],
  [
    WagerTransactionKind.Rollback,
    new Set([WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund]),
  ],
]);

export class WagerTransaction {
  readonly id: string;
  readonly provider: ProviderReference;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly game: GameContext;
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId: string | undefined;
  private readonly _createdAt: Date;
  private outcome: WagerTransactionOutcome;

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.provider = Object.freeze({ ...state.provider });
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.game = Object.freeze({ ...state.game });
    this.kind = state.kind;
    this.money = state.money;
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this._createdAt = copyDate(state.createdAt);
    this.outcome = { ...state.outcome, processedAt: copyDate(state.outcome.processedAt) };
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertSubmittable(props);
    return new WagerTransaction({ ...props, outcome: PENDING_OUTCOME });
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  get createdAt(): Date {
    return copyDate(this._createdAt);
  }

  get status(): WagerTransactionStatus {
    return this.outcome.status;
  }

  get referenceTransactionId(): string | undefined {
    return this.outcome.referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this.outcome.failureCode;
  }

  get observedBalance(): Money | undefined {
    return this.outcome.observedBalance;
  }

  get processedAt(): Date | undefined {
    return copyDate(this.outcome.processedAt);
  }

  markProcessed(props: MarkProcessedProps): void {
    this.assertNotTerminal("markProcessed");
    if (this.requiresReference() && !props.referenceTransactionId) {
      throw new InvalidWagerTransactionError(`${this.kind} processado exige o id interno da referência`);
    }
    this.outcome = {
      status: WagerTransactionStatus.Processed,
      referenceTransactionId: props.referenceTransactionId,
      failureCode: undefined,
      observedBalance: props.observedBalance,
      processedAt: copyDate(props.at),
    };
  }

  markPendingReference(): void {
    this.assertNotTerminal("markPendingReference");
    if (!this.requiresReference()) {
      throw new InvalidTransactionStateError(this.id, this.status, "markPendingReference");
    }
    this.outcome = { ...PENDING_OUTCOME, status: WagerTransactionStatus.PendingReference };
  }

  reject(props: RejectProps): void {
    this.assertNotTerminal("reject");
    this.outcome = {
      status: WagerTransactionStatus.Rejected,
      referenceTransactionId: props.referenceTransactionId,
      failureCode: props.code,
      observedBalance: props.observedBalance,
      processedAt: copyDate(props.at),
    };
  }

  fail(props: FailProps): void {
    this.assertNotTerminal("fail");
    this.outcome = {
      status: WagerTransactionStatus.Failed,
      referenceTransactionId: undefined,
      failureCode: props.code,
      observedBalance: undefined,
      processedAt: copyDate(props.at),
    };
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this.status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return REVERSIBLE_KINDS_BY_REVERSAL.has(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        return this.inverseDirectionOf(reference);
      case WagerTransactionKind.Loss:
        throw new InvalidWagerTransactionError("LOSS não movimenta saldo");
    }
  }

  validateReversalOf(reference: WagerTransaction): void {
    this.assertIsReversalTargeting(reference);
    this.assertSameContextAs(reference);
    this.assertCanReverseKind(reference);
    this.assertReferenceProcessed(reference);
    this.assertSameAmountAs(reference);
  }

  private static assertSubmittable(props: CreateWagerTransactionProps): void {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError("OPENING é interno e não pode ser submetido");
    }
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(`Valor da transação deve ser positivo: ${props.money}`);
    }
    if (REVERSIBLE_KINDS_BY_REVERSAL.has(props.kind) && !props.referenceExternalTransactionId) {
      throw new InvalidWagerTransactionError(`${props.kind} exige referenceExternalTransactionId`);
    }
  }

  private inverseDirectionOf(reference: WagerTransaction | undefined): LedgerDirection {
    if (!reference) {
      throw new InvalidWagerTransactionError("ROLLBACK exige a referência para definir a direção");
    }
    return reference.ledgerDirectionFor() === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
  }

  private assertIsReversalTargeting(reference: WagerTransaction): void {
    if (!this.requiresReference()) {
      throw new InvalidWagerTransactionError(`${this.kind} não reverte transações`);
    }
    if (reference.provider.externalTransactionId !== this.referenceExternalTransactionId) {
      throw new InvalidWagerTransactionError(
        `Referência ${reference.provider.externalTransactionId} não é a informada (${this.referenceExternalTransactionId})`,
      );
    }
    if (!reference.isTerminal()) {
      throw new InvalidWagerTransactionError(`Referência ${reference.id} ainda não está em estado terminal`);
    }
  }

  private assertSameContextAs(reference: WagerTransaction): void {
    const sameContext =
      reference.provider.providerId === this.provider.providerId &&
      reference.playerId === this.playerId &&
      reference.walletId === this.walletId &&
      reference.game.roundId === this.game.roundId &&
      reference.money.currency === this.money.currency;

    if (!sameContext) {
      throw new WagerRuleViolationError(
        FailureCode.ReferenceMismatch,
        `Referência ${reference.id} é de outro provider, player, wallet, moeda ou rodada`,
      );
    }
  }

  private assertCanReverseKind(reference: WagerTransaction): void {
    if (!REVERSIBLE_KINDS_BY_REVERSAL.get(this.kind)?.has(reference.kind)) {
      throw new WagerRuleViolationError(FailureCode.InvalidReferenceKind, `${this.kind} não reverte ${reference.kind}`);
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

  private assertSameAmountAs(reference: WagerTransaction): void {
    if (!reference.money.equals(this.money)) {
      throw new WagerRuleViolationError(
        FailureCode.ReversalAmountMismatch,
        `Valor ${this.money} difere da referência ${reference.money}`,
      );
    }
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) throw new InvalidTransactionStateError(this.id, this.status, action);
  }
}
