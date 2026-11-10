import { describe, expect, test } from "bun:test";
import { BusinessRuleError } from "../../../../src/domain/shared/business-rule.error";
import { FailureCode } from "../../../../src/domain/wagering/failure-code";
import { ReversalPolicy } from "../../../../src/domain/wagering/reversal-policy";
import { WagerTransactionKind } from "../../../../src/domain/wagering/wager-transaction-kind";
import { WagerTransaction, type CreateWagerTransactionProps } from "../../../../src/domain/wagering/wager-transaction";
import {
  InvalidWagerTransactionError,
  WagerRuleViolationError,
} from "../../../../src/domain/wagering/wager-transaction.errors";
import { captureError } from "../../../support/errors";
import { brl, usd } from "../../../support/money";

const createdAt = new Date("2026-11-09T12:00:00.000Z");
const at = new Date("2026-11-09T12:00:01.000Z");
const policy = new ReversalPolicy();

const props = (overrides: Partial<CreateWagerTransactionProps> = {}): CreateWagerTransactionProps => ({
  id: "tx-1",
  provider: { providerId: "provider-a", externalTransactionId: "ext-1" },
  idempotencyKey: "provider-a:ext-1",
  payloadHash: "hash-1",
  walletId: "wallet-1",
  playerId: "player-1",
  game: { roundId: "round-1", gameId: "game-1" },
  kind: WagerTransactionKind.Bet,
  money: brl("25.00"),
  referenceExternalTransactionId: undefined,
  createdAt,
  ...overrides,
});

const KINDS_WITH_REFERENCE: readonly WagerTransactionKind[] = [
  WagerTransactionKind.Win,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

const referenceFor = (kind: WagerTransactionKind): Partial<CreateWagerTransactionProps> =>
  KINDS_WITH_REFERENCE.includes(kind) ? { referenceExternalTransactionId: "ext-0" } : {};

const bet = (overrides: Partial<CreateWagerTransactionProps> = {}) => WagerTransaction.create(props(overrides));

const processed = (overrides: Partial<CreateWagerTransactionProps> = {}) => {
  const tx = bet(overrides);
  const referenceTransactionId = tx.requiresReference() ? "tx-0" : undefined;
  tx.markProcessed({ at, observedBalance: brl("75.00"), referenceTransactionId });
  return tx;
};

const reversal = (
  kind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  overrides: Partial<CreateWagerTransactionProps> = {},
) =>
  WagerTransaction.create(
    props({
      id: "tx-rev",
      provider: { providerId: "provider-a", externalTransactionId: "ext-rev" },
      idempotencyKey: "provider-a:ext-rev",
      kind,
      referenceExternalTransactionId: "ext-1",
      ...overrides,
    }),
  );

function expectViolation(fn: () => unknown, code: FailureCode): void {
  const error = captureError(fn);
  expect(error).toBeInstanceOf(WagerRuleViolationError);
  expect(error).toBeInstanceOf(BusinessRuleError);
  expect((error as WagerRuleViolationError).failureCode).toBe(code);
}

describe("ReversalPolicy", () => {
  test("REFUND de BET processada da mesma rodada e valor é válido", () => {
    expect(() => policy.validate(reversal(WagerTransactionKind.Refund), processed())).not.toThrow();
  });

  test.each([WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund])(
    "ROLLBACK de %s processado é válido",
    (kind) => {
      const reference = processed({ kind, ...referenceFor(kind) });
      expect(() => policy.validate(reversal(WagerTransactionKind.Rollback), reference)).not.toThrow();
    },
  );

  test.each<[string, Partial<CreateWagerTransactionProps>]>([
    ["provider", { provider: { providerId: "provider-b", externalTransactionId: "ext-1" } }],
    ["player", { playerId: "player-2" }],
    ["wallet", { walletId: "wallet-2" }],
    ["rodada", { game: { roundId: "round-2", gameId: "game-1" } }],
    ["moeda", { money: usd("25.00") }],
  ])("referência de outro(a) %s → REFERENCE_MISMATCH", (_label, overrides) => {
    expectViolation(
      () => policy.validate(reversal(WagerTransactionKind.Refund), processed(overrides)),
      FailureCode.ReferenceMismatch,
    );
  });

  test.each([WagerTransactionKind.Win, WagerTransactionKind.Loss, WagerTransactionKind.Refund])(
    "REFUND de %s → INVALID_REFERENCE_KIND",
    (kind) => {
      const reference = processed({ kind, ...referenceFor(kind) });
      expectViolation(
        () => policy.validate(reversal(WagerTransactionKind.Refund), reference),
        FailureCode.InvalidReferenceKind,
      );
    },
  );

  test.each([WagerTransactionKind.Loss, WagerTransactionKind.Rollback])(
    "ROLLBACK de %s → INVALID_REFERENCE_KIND",
    (kind) => {
      const reference = processed({ kind, ...referenceFor(kind) });
      expectViolation(
        () => policy.validate(reversal(WagerTransactionKind.Rollback), reference),
        FailureCode.InvalidReferenceKind,
      );
    },
  );

  test.each([
    [
      "REJECTED",
      (tx: WagerTransaction) => tx.reject({ code: FailureCode.InsufficientFunds, at, observedBalance: brl("1.00") }),
    ],
    ["FAILED", (tx: WagerTransaction) => tx.fail({ code: FailureCode.InsufficientFunds, at })],
  ])("referência %s → REFERENCE_NOT_PROCESSED", (_label, finish) => {
    const reference = bet();
    finish(reference);
    expectViolation(
      () => policy.validate(reversal(WagerTransactionKind.Refund), reference),
      FailureCode.ReferenceNotProcessed,
    );
  });

  test("valor diferente da referência → REVERSAL_AMOUNT_MISMATCH", () => {
    expectViolation(
      () => policy.validate(reversal(WagerTransactionKind.Refund, { money: brl("10.00") }), processed()),
      FailureCode.ReversalAmountMismatch,
    );
  });

  test("referência ainda não terminal é erro de programação: o chamador deve esperar", () => {
    const error = captureError(() => policy.validate(reversal(WagerTransactionKind.Refund), bet()));
    expect(error).toBeInstanceOf(InvalidWagerTransactionError);
    expect(error).not.toBeInstanceOf(BusinessRuleError);
  });

  test("referência com outro externalTransactionId é erro de programação", () => {
    const refund = reversal(WagerTransactionKind.Refund, { referenceExternalTransactionId: "ext-9" });
    expect(() => policy.validate(refund, processed())).toThrow(InvalidWagerTransactionError);
  });

  test("só REFUND e ROLLBACK revertem", () => {
    expect(() => policy.validate(bet({ kind: WagerTransactionKind.Win }), processed())).toThrow(
      InvalidWagerTransactionError,
    );
  });
});
