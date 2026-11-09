import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  computePayloadHash,
  type WagerTransactionPayload,
} from "../../../../src/application/wagering/payload-hash";

const payload = (overrides: Partial<WagerTransactionPayload> = {}): WagerTransactionPayload => ({
  providerId: "provider-a",
  externalTransactionId: "transaction-123",
  playerId: "player-1",
  walletId: "wallet-1",
  roundId: "round-987",
  gameId: "fortune-chimp",
  kind: "BET",
  money: { amount: "25.00", currency: "BRL" },
  referenceExternalTransactionId: undefined,
  ...overrides,
});

describe("computePayloadHash", () => {
  test("é SHA-256 hex do JSON canônico com chaves ordenadas", () => {
    const canonical =
      '{"externalTransactionId":"transaction-123","gameId":"fortune-chimp","kind":"BET",' +
      '"money":{"amount":"25.00","currency":"BRL"},"playerId":"player-1","providerId":"provider-a",' +
      '"referenceExternalTransactionId":null,"roundId":"round-987","walletId":"wallet-1"}';
    const expected = createHash("sha256").update(canonical).digest("hex");

    expect(computePayloadHash(payload())).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a ordem das chaves de entrada não importa", () => {
    const reordered = {
      money: { currency: "BRL", amount: "25.00" },
      kind: "BET",
      gameId: "fortune-chimp",
      roundId: "round-987",
      walletId: "wallet-1",
      playerId: "player-1",
      externalTransactionId: "transaction-123",
      providerId: "provider-a",
      referenceExternalTransactionId: undefined,
    } satisfies WagerTransactionPayload;
    expect(computePayloadHash(reordered)).toBe(computePayloadHash(payload()));
  });

  test("valor é normalizado antes do hash: 25.5 e 25.50 são a mesma operação", () => {
    expect(computePayloadHash(payload({ money: { amount: "25.5", currency: "BRL" } }))).toBe(
      computePayloadHash(payload({ money: { amount: "25.50", currency: "BRL" } })),
    );
  });

  test("referência ausente equivale a referência indefinida", () => {
    const { referenceExternalTransactionId: _omitted, ...withoutReference } = payload();
    expect(computePayloadHash(withoutReference as WagerTransactionPayload)).toBe(computePayloadHash(payload()));
  });

  test("campos fora do contrato de negócio não entram no hash", () => {
    const withTransportFields = { ...payload(), idempotencyKey: "provider-a:transaction-123", messageId: "msg-1" };
    expect(computePayloadHash(withTransportFields)).toBe(computePayloadHash(payload()));
  });

  test.each<[string, Partial<WagerTransactionPayload>]>([
    ["valor", { money: { amount: "25.01", currency: "BRL" } }],
    ["moeda", { money: { amount: "25.00", currency: "USD" } }],
    ["kind", { kind: "WIN" }],
    ["rodada", { roundId: "round-988" }],
    ["jogo", { gameId: "other-game" }],
    ["wallet", { walletId: "wallet-2" }],
    ["player", { playerId: "player-2" }],
    ["referência", { referenceExternalTransactionId: "transaction-100" }],
  ])("muda quando o campo de negócio %s muda", (_field, overrides) => {
    expect(computePayloadHash(payload(overrides))).not.toBe(computePayloadHash(payload()));
  });
});
