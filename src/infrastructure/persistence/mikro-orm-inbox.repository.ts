import { UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { InboxMessage } from "../../application/messaging/inbox-message";
import { DuplicateInboxMessageError, type InboxRepository } from "../../application/ports/inbox.repository";
import { InboxMessageRecord } from "./records";

export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async isProcessed(consumerName: string, messageId: string): Promise<boolean> {
    const count = await this.em.count(InboxMessageRecord, { consumerName, messageId, processedAt: { $ne: null } });
    return count > 0;
  }

  async add(message: InboxMessage): Promise<void> {
    try {
      await this.em.insert(InboxMessageRecord, {
        consumerName: message.consumerName,
        messageId: message.messageId,
        payloadHash: message.payloadHash,
        receivedAt: message.receivedAt,
        processedAt: message.processedAt ?? null,
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new DuplicateInboxMessageError(message.consumerName, message.messageId);
      }
      throw error;
    }
  }
}
