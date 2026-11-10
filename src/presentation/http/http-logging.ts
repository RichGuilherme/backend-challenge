import type { IncomingMessage, ServerResponse } from "node:http";
import { CORRELATION_ID_HEADER, resolveCorrelationId } from "./correlation-id";

const QUIET_PATHS = ["/metrics", "/health"];

export function assignCorrelationId(request: IncomingMessage, response: ServerResponse): string {
  const header = request.headers[CORRELATION_ID_HEADER];
  const correlationId = resolveCorrelationId(Array.isArray(header) ? header[0] : header);
  request.headers[CORRELATION_ID_HEADER] = correlationId;
  response.setHeader(CORRELATION_ID_HEADER, correlationId);
  return correlationId;
}

export function isQuietRequest(request: IncomingMessage): boolean {
  return QUIET_PATHS.some((path) => request.url?.startsWith(path));
}
