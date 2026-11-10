import type { IdGenerator } from "../ports/id-generator";
import type { EventContext } from "./integration-events";

export interface EventTrace {
  correlationId: string;
  causationId?: string | undefined;
}

export function eventContextFactory(trace: EventTrace, ids: IdGenerator, occurredAt: Date): () => EventContext {
  return () => ({
    eventId: ids.next(),
    correlationId: trace.correlationId,
    causationId: trace.causationId,
    occurredAt,
  });
}
