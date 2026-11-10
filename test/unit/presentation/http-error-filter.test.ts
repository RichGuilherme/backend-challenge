import { describe, expect, test } from "bun:test";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import type { LogFields, Logger } from "../../../src/application/ports/logger";
import { TransientFailureError } from "../../../src/application/shared/application-error";
import { WalletNotFoundError } from "../../../src/application/wallet/wallet.errors";
import { HttpErrorFilter } from "../../../src/presentation/http/http-error.filter";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  fields: LogFields | undefined;
}

function capturingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record = (level: LogEntry["level"]) => (message: string, fields?: LogFields) => {
    entries.push({ level, message, fields });
  };
  return { logger: { info: record("info"), warn: record("warn"), error: record("error") }, entries };
}

function respondTo(filter: HttpErrorFilter, exception: unknown, correlationId = "corr-1") {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return response;
    },
    setHeader: () => undefined,
    json(body: unknown) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ headers: { "x-correlation-id": correlationId } }),
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return sent;
}

describe("HttpErrorFilter", () => {
  test("erro inesperado vira 500 genérico e é logado com correlationId e stack", () => {
    const { logger, entries } = capturingLogger();
    const failure = new Error("falha interna com detalhe");

    const sent = respondTo(new HttpErrorFilter(logger), failure, "corr-42");

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ error: "INTERNAL_ERROR", message: "Erro interno" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "error",
      message: "erro inesperado na requisição",
      fields: { correlationId: "corr-42", errorName: "Error", errorMessage: "falha interna com detalhe" },
    });
    expect(String(entries[0]!.fields!.stack)).toContain("falha interna com detalhe");
  });

  test.each<[string, unknown]>([
    ["erro de negócio conhecido", new WalletNotFoundError("w-1")],
    ["falha transitória", new TransientFailureError("lock")],
    ["exceção do framework", new HttpException("x", 404)],
  ])("%s não gera log de erro", (_label, exception) => {
    const { logger, entries } = capturingLogger();

    respondTo(new HttpErrorFilter(logger), exception);

    expect(entries.filter((entry) => entry.level === "error")).toEqual([]);
  });
});
