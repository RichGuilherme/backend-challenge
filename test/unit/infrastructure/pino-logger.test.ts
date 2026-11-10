import { describe, expect, test } from "bun:test";
import { PinoLogger, createRootLogger } from "../../../src/infrastructure/observability/pino-logger";

function capture(level = "info") {
  const lines: Record<string, unknown>[] = [];
  const stream = { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) };
  return { lines, logger: new PinoLogger(createRootLogger({ service: "teste", level }, stream)) };
}

describe("PinoLogger", () => {
  test("escreve JSON com mensagem, serviço e campos de correlação", () => {
    const { lines, logger } = capture();

    logger.info("transação liquidada", {
      correlationId: "corr-1",
      messageId: "msg-1",
      transactionId: "tx-1",
      walletId: "wallet-1",
      providerId: "provider-a",
      status: "PROCESSED",
    });

    expect(lines).toEqual([
      expect.objectContaining({
        level: 30,
        service: "teste",
        msg: "transação liquidada",
        correlationId: "corr-1",
        messageId: "msg-1",
        transactionId: "tx-1",
        walletId: "wallet-1",
        providerId: "provider-a",
        status: "PROCESSED",
      }),
    ]);
  });

  test("níveis warn e error", () => {
    const { lines, logger } = capture();
    logger.warn("aviso");
    logger.error("falha", { error: "boom" });
    expect(lines.map((line) => line.level)).toEqual([40, 50]);
  });

  test("nunca escreve o payload financeiro: money, amount, payload e body são censurados", () => {
    const { lines, logger } = capture();

    logger.info("x", {
      money: { amount: "25.00", currency: "BRL" },
      amount: "25.00",
      payload: { kind: "BET" },
      body: { secret: 1 },
      nested: { money: { amount: "9.99" }, amount: "9.99" },
      transactionId: "tx-1",
    });

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("25.00");
    expect(serialized).not.toContain("9.99");
    expect(serialized).not.toContain("secret");
    expect(lines[0]).toMatchObject({ transactionId: "tx-1", money: "[REDACTED]", amount: "[REDACTED]" });
  });

  test("nível silent não escreve nada", () => {
    const { lines, logger } = capture("silent");
    logger.error("falha");
    expect(lines).toEqual([]);
  });
});
