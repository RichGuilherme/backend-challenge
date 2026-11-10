import type { OutboxMessage } from "../messaging/outbox-message";
import { ApplicationError } from "../shared/application-error";

export interface EventPublisher {
  publish(message: OutboxMessage): Promise<void>;
}

export class EventPublishFailedError extends ApplicationError {
  constructor(
    readonly messageId: string,
    reason: string,
  ) {
    super(`Falha ao publicar o evento ${messageId}: ${reason}`);
  }
}
