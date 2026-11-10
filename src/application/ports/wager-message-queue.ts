export interface QueueMessage {
  body: string;
  receiptHandle: string;
  queueMessageId: string;
  receiveCount: number;
  groupId: string | undefined;
  correlationId: string | undefined;
}

export interface WagerMessageQueue {
  receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]>;
  acknowledge(message: QueueMessage): Promise<void>;
  retryLater(message: QueueMessage, delayMs: number): Promise<void>;
  release(message: QueueMessage): Promise<void>;
  deadLetter(message: QueueMessage, reason: string): Promise<void>;
}
