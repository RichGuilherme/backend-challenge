import { Catch, HttpException, HttpStatus, Inject, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { LOGGER, type Logger } from "../../application/ports/logger";
import { TransientFailureError } from "../../application/shared/application-error";
import { IdempotencyConflictError, WagerTransactionNotFoundError } from "../../application/wagering/wagering.errors";
import {
  WalletAlreadyExistsError,
  WalletNotFoundError,
  WalletPlayerMismatchError,
} from "../../application/wallet/wallet.errors";
import { CORRELATION_ID_HEADER } from "./correlation-id";
import { InvalidPayloadError } from "./invalid-payload.error";

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface ErrorResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  unexpected?: boolean;
}

const TRANSIENT_RETRY_AFTER_SECONDS = "1";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body, headers = {}, unexpected = false } = toErrorResponse(exception);
    const http = host.switchToHttp();
    if (unexpected) this.logUnexpected(exception, http.getRequest<HttpRequest>());
    const response = http.getResponse<HttpResponse>();
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.status(status).json(body);
  }

  private logUnexpected(exception: unknown, request: HttpRequest): void {
    const header = request.headers[CORRELATION_ID_HEADER];
    const failure = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error("erro inesperado na requisição", {
      correlationId: Array.isArray(header) ? header[0] : header,
      errorName: failure.name,
      errorMessage: failure.message,
      stack: failure.stack,
    });
  }
}

function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof InvalidPayloadError) {
    return error(HttpStatus.BAD_REQUEST, "INVALID_PAYLOAD", exception.message, { details: exception.issues });
  }
  if (exception instanceof WalletPlayerMismatchError) {
    return error(HttpStatus.BAD_REQUEST, "WALLET_PLAYER_MISMATCH", exception.message);
  }
  if (exception instanceof WalletNotFoundError) {
    return error(HttpStatus.NOT_FOUND, "WALLET_NOT_FOUND", exception.message);
  }
  if (exception instanceof WagerTransactionNotFoundError) {
    return error(HttpStatus.NOT_FOUND, "TRANSACTION_NOT_FOUND", exception.message);
  }
  if (exception instanceof WalletAlreadyExistsError) {
    return error(HttpStatus.CONFLICT, "WALLET_ALREADY_EXISTS", exception.message);
  }
  if (exception instanceof IdempotencyConflictError) {
    return error(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", exception.message, { reason: exception.reason });
  }
  if (exception instanceof TransientFailureError) {
    return {
      ...error(HttpStatus.SERVICE_UNAVAILABLE, "TRANSIENT_FAILURE", "Falha transitória, tente novamente"),
      headers: { "Retry-After": TRANSIENT_RETRY_AFTER_SECONDS },
    };
  }
  if (exception instanceof HttpException) return fromFrameworkException(exception);
  return { ...error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Erro interno"), unexpected: true };
}

function fromFrameworkException(exception: HttpException): ErrorResponse {
  const status = exception.getStatus();
  if (status === HttpStatus.BAD_REQUEST) return error(status, "INVALID_PAYLOAD", "Corpo da requisição inválido");
  if (status === HttpStatus.NOT_FOUND) return error(status, "ROUTE_NOT_FOUND", exception.message);
  return error(status, "HTTP_ERROR", exception.message);
}

function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ErrorResponse {
  return { status, body: { error: code, message, ...extra } };
}
