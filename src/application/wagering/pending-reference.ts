import { fullJitterDelayMs, type BackoffPolicy, type RandomSource } from "../messaging/full-jitter";

export interface PendingReferencePolicy {
  ttlMs: number;
  backoff: BackoffPolicy;
}

export const DEFAULT_PENDING_REFERENCE_POLICY: PendingReferencePolicy = {
  ttlMs: 24 * 60 * 60 * 1_000,
  backoff: { baseMs: 2_000, capMs: 600_000 },
};

export interface PendingReferenceState {
  transactionId: string;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date;
}

export class PendingReference {
  readonly transactionId: string;
  readonly expiresAt: Date;
  private _attempts: number;
  private _nextAttemptAt: Date;

  private constructor(state: PendingReferenceState) {
    this.transactionId = state.transactionId;
    this.expiresAt = state.expiresAt;
    this._attempts = state.attempts;
    this._nextAttemptAt = state.nextAttemptAt;
  }

  static schedule(
    transactionId: string,
    now: Date,
    policy: PendingReferencePolicy,
    random: RandomSource,
  ): PendingReference {
    const expiresAt = new Date(now.getTime() + policy.ttlMs);
    const pending = new PendingReference({ transactionId, attempts: 0, nextAttemptAt: now, expiresAt });
    pending._nextAttemptAt = pending.nextAttemptAfter(now, 1, policy, random);
    return pending;
  }

  static rehydrate(state: PendingReferenceState): PendingReference {
    return new PendingReference(state);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date {
    return this._nextAttemptAt;
  }

  isDue(now: Date): boolean {
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  reschedule(now: Date, policy: PendingReferencePolicy, random: RandomSource): void {
    this._attempts += 1;
    this._nextAttemptAt = this.nextAttemptAfter(now, this._attempts + 1, policy, random);
  }

  private nextAttemptAfter(now: Date, attempt: number, policy: PendingReferencePolicy, random: RandomSource): Date {
    const candidate = now.getTime() + fullJitterDelayMs(attempt, policy.backoff, random);
    return new Date(Math.min(candidate, this.expiresAt.getTime()));
  }
}
