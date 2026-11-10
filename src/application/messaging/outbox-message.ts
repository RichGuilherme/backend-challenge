import { fullJitterDelayMs, type BackoffPolicy, type RandomSource } from "./full-jitter";
import type { IntegrationEvent } from "./integration-event";

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  partitionKey: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt: Date | undefined;
}

export class OutboxMessage {
  readonly id: string;
  readonly aggregateId: string;
  readonly partitionKey: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt: Date;
  private _publishedAt: Date | undefined;

  private constructor(state: OutboxMessageState) {
    this.id = state.id;
    this.aggregateId = state.aggregateId;
    this.partitionKey = state.partitionKey;
    this.eventType = state.eventType;
    this.payload = state.payload;
    this.occurredAt = state.occurredAt;
    this._attempts = state.attempts;
    this._nextAttemptAt = state.nextAttemptAt;
    this._publishedAt = state.publishedAt;
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      partitionKey: event.partitionKey,
      eventType: event.eventType,
      payload: JSON.parse(JSON.stringify(event.toJSON())) as Record<string, unknown>,
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: event.occurredAt,
      publishedAt: undefined,
    });
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    return this.isPending() && this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    this.assertPending("markPublished");
    this._publishedAt = at;
  }

  scheduleRetry(now: Date, policy: BackoffPolicy, random: RandomSource): void {
    this.assertPending("scheduleRetry");
    this._attempts += 1;
    this._nextAttemptAt = new Date(now.getTime() + fullJitterDelayMs(this._attempts, policy, random));
  }

  private assertPending(action: string): void {
    if (!this.isPending()) throw new Error(`Mensagem ${this.id} já publicada não aceita ${action}`);
  }
}
