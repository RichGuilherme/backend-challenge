import type {
  ConsumeWagerMessageUseCase,
  WagerMessage,
} from "../../application/messaging/consume-wager-message.use-case";
import {
  fullJitterDelayMs,
  type BackoffPolicy,
  type RandomSource,
} from "../../application/messaging/full-jitter";
import type {
  QueueMessage,
  WagerMessageQueue,
} from "../../application/ports/wager-message-queue";
import { IdempotencyConflictError } from "../../application/wagering/wagering.errors";
import {
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from "../../application/wallet/wallet.errors";
import {
  wagerTransactionRequestedSchema,
  type WagerTransactionRequested,
} from "../schemas";

export const WAGER_CONSUMER_NAME = "wager-transactions-consumer";

export interface WagerMessageConsumerOptions {
  batchSize: number;
  waitSeconds: number;
  retry: BackoffPolicy;
}

export interface ConsumerLogger {
  warn(event: string, fields: Record<string, unknown>): void;
}

type ParseResult =
  | { ok: true; message: WagerTransactionRequested }
  | { ok: false; reason: string };

const PERMANENT_ERRORS = [
  WalletNotFoundError,
  WalletPlayerMismatchError,
  IdempotencyConflictError,
];

export class WagerMessageConsumer {
  private stopping = false;

  constructor(
    private readonly queue: WagerMessageQueue,
    private readonly consume: ConsumeWagerMessageUseCase,
    private readonly options: WagerMessageConsumerOptions,
    private readonly logger: ConsumerLogger,
    private readonly random: RandomSource = Math.random,
  ) {}

  requestStop(): void {
    this.stopping = true;
  }

  async pollOnce(): Promise<boolean> {
    if (this.stopping) return false;

    const messages = await this.queue.receive(
      this.options.batchSize,
      this.options.waitSeconds,
    );

    for (const [index, message] of messages.entries()) {
      if (this.stopping) {
        await Promise.all(
          messages.slice(index).map((pending) => this.queue.release(pending)),
        );
        break;
      }
      await this.handle(message);
    }
    return messages.length > 0;
  }

  private async handle(message: QueueMessage): Promise<void> {
    const parsed = parse(message.body);

    if (!parsed.ok) {
      await this.deadLetter(message, parsed.reason);
      return;
    }

    try {
      await this.consume.execute(toWagerMessage(parsed.message, message));
      await this.queue.acknowledge(message);
    } catch (error) {
      if (PERMANENT_ERRORS.some((permanent) => error instanceof permanent)) {
        await this.deadLetter(message, (error as Error).message);
        return;
      }

      const delayMs = fullJitterDelayMs(
        message.receiveCount,
        this.options.retry,
        this.random,
      );

      this.logger.warn("mensagem será reprocessada", {
        messageId: parsed.message.messageId,
        receiveCount: message.receiveCount,
        delayMs,
        error: String(error),
      });
      await this.queue.retryLater(message, delayMs);
    }
  }

  private async deadLetter(
    message: QueueMessage,
    reason: string,
  ): Promise<void> {
    this.logger.warn("mensagem enviada para a DLQ", {
      queueMessageId: message.queueMessageId,
      reason,
    });
    await this.queue.deadLetter(message, reason);
  }
}

function parse(body: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "INVALID_JSON" };
  }

  const result = wagerTransactionRequestedSchema.safeParse(json);

  if (result.success) return { ok: true, message: result.data };

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  return { ok: false, reason: `INVALID_PAYLOAD: ${details}` };
}

function toWagerMessage(
  envelope: WagerTransactionRequested,
  message: QueueMessage,
): WagerMessage {
  return {
    consumerName: WAGER_CONSUMER_NAME,
    messageId: envelope.messageId,
    command: {
      ...envelope.data,
      correlationId: message.correlationId ?? envelope.messageId,
      causationId: envelope.messageId,
    },
  };
}
