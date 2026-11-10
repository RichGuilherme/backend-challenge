import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";

const ACCEPTED_CORRELATION_ID = /^[\w.:-]{1,128}$/;

export function resolveCorrelationId(header: string | undefined): string {
  return header !== undefined && ACCEPTED_CORRELATION_ID.test(header) ? header : randomUUID();
}
