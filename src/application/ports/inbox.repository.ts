import type { InboxMessage } from "../messaging/inbox-message";
import { ApplicationError } from "../shared/application-error";

export interface InboxRepository {
  isProcessed(consumerName: string, messageId: string): Promise<boolean>;
  add(message: InboxMessage): Promise<void>;
}

export class DuplicateInboxMessageError extends ApplicationError {
  constructor(
    readonly consumerName: string,
    readonly messageId: string,
  ) {
    super(`Mensagem ${messageId} já registrada na inbox de ${consumerName}`);
  }
}
