import type { OutboxMessage } from "../messaging/outbox-message";

export interface OutboxRepository {
  add(messages: readonly OutboxMessage[]): Promise<void>;
  claimDue(now: Date, limit: number): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
}
