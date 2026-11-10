import type { LoggerService } from "@nestjs/common";
import type { Logger as PinoInstance } from "pino";

export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: PinoInstance) {}

  log(message: unknown, ...context: unknown[]): void {
    this.logger.info(contextOf(context), String(message));
  }

  error(message: unknown, ...context: unknown[]): void {
    this.logger.error(contextOf(context), String(message));
  }

  warn(message: unknown, ...context: unknown[]): void {
    this.logger.warn(contextOf(context), String(message));
  }

  debug(message: unknown, ...context: unknown[]): void {
    this.logger.debug(contextOf(context), String(message));
  }

  verbose(message: unknown, ...context: unknown[]): void {
    this.logger.trace(contextOf(context), String(message));
  }

  fatal(message: unknown, ...context: unknown[]): void {
    this.logger.fatal(contextOf(context), String(message));
  }
}

function contextOf(context: unknown[]): { context?: string } {
  const last = context.at(-1);
  return typeof last === "string" ? { context: last } : {};
}
