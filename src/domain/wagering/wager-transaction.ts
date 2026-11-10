import type { Money } from "../shared/money/money";
import { copyDate } from "../shared/copy-date";
import { LedgerDirection } from "../wallet/ledger-direction";
import type { FailureCode } from "./failure-code";
import type { GameContext } from "./game-context";
import type { ProviderReference } from "./provider-reference";
import { REVERSIBLE_KINDS_BY_REVERSAL } from "./reversible-kinds";
import { WagerTransactionKind } from "./wager-transaction-kind";
import type { WagerTransactionOutcome } from "./wager-transaction-outcome";
import { WagerTransactionStatus } from "./wager-transaction-status";
import { InvalidTransactionStateError, InvalidWagerTransactionError } from "./wager-transaction.errors";

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
  referenceTransactionId?: string | undefined;
}

export interface FailProps {
  code: FailureCode;
  at: Date;
}

export interface OpeningProps {
  id: string;
  walletId: string;
  playerId: string;
  money: Money;
  at: Date;
}

export const OPENING_PROVIDER_ID = "internal";
const OPENING_GAME: GameContext = { roundId: "opening", gameId: "opening" };
const OPENING_PAYLOAD_HASH = "opening";

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

const KINDS_WITHOUT_REFERENCE: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Loss,
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

  static opening(props: OpeningProps): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(`Abertura exige saldo inicial positivo: ${props.money}`);
    }
    return new WagerTransaction({
      id: props.id,
      provider: { providerId: OPENING_PROVIDER_ID, externalTransactionId: props.walletId },
      idempotencyKey: `opening:${props.walletId}`,
      payloadHash: OPENING_PAYLOAD_HASH,
      walletId: props.walletId,
      playerId: props.playerId,
      game: OPENING_GAME,
      kind: WagerTransactionKind.Opening,
      money: props.money,
      referenceExternalTransactionId: undefined,
      createdAt: props.at,
      outcome: {
        status: WagerTransactionStatus.Processed,
        referenceTransactionId: undefined,
        failureCode: undefined,
        observedBalance: props.money,
        processedAt: props.at,
      },
    });
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

  private static assertSubmittable(props: CreateWagerTransactionProps): void {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidWagerTransactionError("OPENING é interno e não pode ser submetido");
    }
    if (props.provider.providerId === OPENING_PROVIDER_ID) {
      throw new InvalidWagerTransactionError(`Provider ${OPENING_PROVIDER_ID} é reservado à abertura de wallet`);
    }
    if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(`Valor da transação deve ser positivo: ${props.money}`);
    }
    if (REVERSIBLE_KINDS_BY_REVERSAL.has(props.kind) && !props.referenceExternalTransactionId) {
      throw new InvalidWagerTransactionError(`${props.kind} exige referenceExternalTransactionId`);
    }
    if (KINDS_WITHOUT_REFERENCE.has(props.kind) && props.referenceExternalTransactionId !== undefined) {
      throw new InvalidWagerTransactionError(`${props.kind} não referencia outra transação`);
    }
  }

  private inverseDirectionOf(reference: WagerTransaction | undefined): LedgerDirection {
    if (!reference) {
      throw new InvalidWagerTransactionError("ROLLBACK exige a referência para definir a direção");
    }
    return reference.ledgerDirectionFor() === LedgerDirection.Debit ? LedgerDirection.Credit : LedgerDirection.Debit;
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) throw new InvalidTransactionStateError(this.id, this.status, action);
  }
}
