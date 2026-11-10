import type { Clock } from "../ports/clock";
import { NO_METRICS, type Metrics } from "../ports/metrics";
import { DuplicateInboxMessageError } from "../ports/inbox.repository";
import type { UnitOfWork } from "../ports/unit-of-work";
import { computePayloadHash } from "../wagering/payload-hash";
import type {
  SubmitWagerTransactionCommand,
  SubmitWagerTransactionUseCase,
} from "../wagering/submit-wager-transaction.use-case";
import type { SubmissionResult } from "../wagering/wager-transaction.view";
import { InboxMessage } from "./inbox-message";

export interface WagerMessage {
  consumerName: string;
  messageId: string;
  command: SubmitWagerTransactionCommand;
}

export type ConsumeOutcome = { kind: "PROCESSED"; result: SubmissionResult } | { kind: "DUPLICATE" };

export class ConsumeWagerMessageUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly submit: SubmitWagerTransactionUseCase,
    private readonly clock: Clock,
    private readonly metrics: Metrics = NO_METRICS,
  ) {}

  async execute(message: WagerMessage): Promise<ConsumeOutcome> {
    if (await this.alreadyProcessed(message)) return { kind: "DUPLICATE" };
    const startedAt = performance.now();
    const receivedAt = this.clock.now();
    try {
      const result = await this.submit.execute(message.command, {
        withinTransaction: async (scope) => {
          const inbox = InboxMessage.receive({
            messageId: message.messageId,
            consumerName: message.consumerName,
            payloadHash: computePayloadHash(message.command),
            receivedAt,
          });
          inbox.markProcessed(this.clock.now());
          await scope.inbox.add(inbox);
        },
      });
      this.metrics.processingDuration("sqs", (performance.now() - startedAt) / 1_000);
      return { kind: "PROCESSED", result };
    } catch (error) {
      if (error instanceof DuplicateInboxMessageError) return { kind: "DUPLICATE" };
      throw error;
    }
  }

  private alreadyProcessed(message: WagerMessage): Promise<boolean> {
    return this.unitOfWork.run(({ inbox }) => inbox.isProcessed(message.consumerName, message.messageId));
  }
}
