import type {
  ConsumeWagerMessageUseCase,
  WagerMessage,
} from "../../application/messaging/consume-wager-message.use-case";
import { fullJitterDelayMs, type BackoffPolicy, type RandomSource } from "../../application/messaging/full-jitter";
import type { DeadLetterReason } from "../../application/ports/metrics";
import type { Observability } from "../../application/ports/observability";
import type { QueueMessage, WagerMessageQueue } from "../../application/ports/wager-message-queue";
import { IdempotencyConflictError } from "../../application/wagering/wagering.errors";
import { WalletNotFoundError, WalletPlayerMismatchError } from "../../application/wallet/wallet.errors";
import { wagerTransactionRequestedSchema, type WagerTransactionRequested } from "../schemas";

export const WAGER_CONSUMER_NAME = "wager-transactions-consumer";

export interface WagerMessageConsumerOptions {
  batchSize: number;
  waitSeconds: number;
  maxReceives: number;
  retry: BackoffPolicy;
}

type ParseResult =
  | { ok: true; message: WagerTransactionRequested }
  | { ok: false; reason: DeadLetterReason; detail: string };

type PermanentError = readonly [new (...args: never[]) => Error, DeadLetterReason];

const PERMANENT_ERRORS: readonly PermanentError[] = [
  [WalletNotFoundError, "WALLET_NOT_FOUND"],
  [WalletPlayerMismatchError, "WALLET_PLAYER_MISMATCH"],
  [IdempotencyConflictError, "IDEMPOTENCY_CONFLICT"],
];

export class WagerMessageConsumer {
  private stopping = false;

  constructor(
    private readonly queue: WagerMessageQueue,
    private readonly consume: ConsumeWagerMessageUseCase,
    private readonly options: WagerMessageConsumerOptions,
    private readonly observability: Observability,
    private readonly random: RandomSource = Math.random,
  ) {}

  requestStop(): void {
    this.stopping = true;
  }

  async pollOnce(): Promise<boolean> {
    if (this.stopping) return false;

    const messages = await this.queue.receive(this.options.batchSize, this.options.waitSeconds);

    for (const [index, message] of messages.entries()) {
      if (this.stopping) {
        await Promise.all(messages.slice(index).map((pending) => this.queue.release(pending)));
        break;
      }
      await this.handle(message);
    }
    return messages.length > 0;
  }

  private async handle(message: QueueMessage): Promise<void> {
    const parsed = parse(message.body);

    if (!parsed.ok) {
      await this.deadLetter(message, parsed.reason, parsed.detail);
      return;
    }

    try {
      await this.consume.execute(toWagerMessage(parsed.message, message));
      await this.queue.acknowledge(message);
    } catch (error) {
      const permanent = PERMANENT_ERRORS.find(([type]) => error instanceof type);
      if (permanent) {
        await this.deadLetter(message, permanent[1], (error as Error).message, parsed.message.messageId);
        return;
      }
      await this.retryOrExhaust(message, parsed.message.messageId, error);
    }
  }

  private async retryOrExhaust(message: QueueMessage, messageId: string, error: unknown): Promise<void> {
    const { metrics, logger } = this.observability;
    const fields = { messageId, queueMessageId: message.queueMessageId, receiveCount: message.receiveCount };

    if (message.receiveCount >= this.options.maxReceives) {
      metrics.deadLettered("RETRIES_EXHAUSTED");
      logger.error("mensagem esgotou as tentativas e será movida para a DLQ pelo redrive", {
        ...fields,
        error: String(error),
      });
      await this.queue.release(message);
      return;
    }

    const delayMs = fullJitterDelayMs(message.receiveCount, this.options.retry, this.random);
    metrics.messageRetry();
    logger.warn("mensagem será reprocessada", { ...fields, delayMs, error: String(error) });
    await this.queue.retryLater(message, delayMs);
  }

  private async deadLetter(
    message: QueueMessage,
    reason: DeadLetterReason,
    detail: string,
    messageId?: string,
  ): Promise<void> {
    const { metrics, logger } = this.observability;
    metrics.deadLettered(reason);
    logger.warn("mensagem enviada para a DLQ", {
      messageId,
      queueMessageId: message.queueMessageId,
      reason,
      detail,
    });
    await this.queue.deadLetter(message, detail);
  }
}

function parse(body: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: "INVALID_JSON", detail: "INVALID_JSON" };
  }

  const result = wagerTransactionRequestedSchema.safeParse(json);

  if (result.success) return { ok: true, message: result.data };

  const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");

  return { ok: false, reason: "INVALID_PAYLOAD", detail: `INVALID_PAYLOAD: ${details}` };
}

function toWagerMessage(envelope: WagerTransactionRequested, message: QueueMessage): WagerMessage {
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
