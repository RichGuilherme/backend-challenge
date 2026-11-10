import pino, { type DestinationStream, type Logger as PinoInstance } from "pino";
import type { LogFields, Logger } from "../../application/ports/logger";

export interface RootLoggerOptions {
  service: string;
  level: string;
}

const NEVER_LOGGED_FIELDS = ["money", "amount", "payload", "body", "*.money", "*.amount", "*.payload", "*.body"];

export function createRootLogger(options: RootLoggerOptions, destination?: DestinationStream): PinoInstance {
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      redact: { paths: NEVER_LOGGED_FIELDS, censor: "[REDACTED]" },
    },
    destination,
  );
}

export class PinoLogger implements Logger {
  constructor(private readonly logger: PinoInstance) {}

  info(message: string, fields: LogFields = {}): void {
    this.logger.info(fields, message);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.logger.warn(fields, message);
  }

  error(message: string, fields: LogFields = {}): void {
    this.logger.error(fields, message);
  }
}
