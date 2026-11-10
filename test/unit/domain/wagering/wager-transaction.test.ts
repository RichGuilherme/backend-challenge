import { describe, expect, test } from "bun:test";
import { Money } from "../../../../src/domain/shared/money/money";
import { LedgerDirection } from "../../../../src/domain/wallet/ledger-direction";
import { BusinessRuleError } from "../../../../src/domain/shared/business-rule.error";
import { FailureCode } from "../../../../src/domain/wagering/failure-code";
import { WagerTransactionKind } from "../../../../src/domain/wagering/wager-transaction-kind";
import { WagerTransactionStatus } from "../../../../src/domain/wagering/wager-transaction-status";
import {
  OPENING_PROVIDER_ID,
  WagerTransaction,
  type CreateWagerTransactionProps,
} from "../../../../src/domain/wagering/wager-transaction";
import {
  InvalidTransactionStateError,
  InvalidWagerTransactionError,
  WagerRuleViolationError,
} from "../../../../src/domain/wagering/wager-transaction.errors";
import { brl, usd } from "../../../support/money";
import { captureError } from "../../../support/errors";

const createdAt = new Date("2026-11-09T12:00:00.000Z");
const at = new Date("2026-11-09T12:00:01.000Z");

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

describe("WagerTransaction", () => {
  describe("create", () => {
    test("nasce PENDING com os dados do provedor", () => {
      const tx = bet();
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.provider).toEqual({ providerId: "provider-a", externalTransactionId: "ext-1" });
      expect(tx.game).toEqual({ roundId: "round-1", gameId: "game-1" });
      expect(tx.kind).toBe(WagerTransactionKind.Bet);
      expect(tx.money.equals(brl("25.00"))).toBe(true);
      expect(tx.failureCode).toBeUndefined();
      expect(tx.processedAt).toBeUndefined();
      expect(tx.observedBalance).toBeUndefined();
      expect(tx.referenceTransactionId).toBeUndefined();
    });

    test("OPENING não pode ser criado por create", () => {
      expect(() => bet({ kind: WagerTransactionKind.Opening })).toThrow(InvalidWagerTransactionError);
    });

    test("provider interno é reservado ao OPENING", () => {
      expect(() => bet({ provider: { providerId: OPENING_PROVIDER_ID, externalTransactionId: "ext-1" } })).toThrow(
        InvalidWagerTransactionError,
      );
    });
  });

  describe("opening", () => {
    test("nasce PROCESSED, do provider interno, com o saldo inicial como saldo observado", () => {
      const tx = WagerTransaction.opening({
        id: "tx-opening",
        walletId: "wallet-1",
        playerId: "player-1",
        money: brl("100.00"),
        at: createdAt,
      });

      expect(tx.kind).toBe(WagerTransactionKind.Opening);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.provider).toEqual({ providerId: OPENING_PROVIDER_ID, externalTransactionId: "wallet-1" });
      expect(tx.idempotencyKey).toBe("opening:wallet-1");
      expect(tx.game).toEqual({ roundId: "opening", gameId: "opening" });
      expect(tx.walletId).toBe("wallet-1");
      expect(tx.playerId).toBe("player-1");
      expect(tx.observedBalance?.equals(brl("100.00"))).toBe(true);
      expect(tx.processedAt).toEqual(createdAt);
      expect(tx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
    });

    test("exige valor positivo", () => {
      expect(() =>
        WagerTransaction.opening({
          id: "tx-opening",
          walletId: "wallet-1",
          playerId: "player-1",
          money: Money.zero("BRL"),
          at: createdAt,
        }),
      ).toThrow(InvalidWagerTransactionError);
    });

    test.each(Object.values(WagerTransactionKind).filter((kind) => kind !== WagerTransactionKind.Opening))(
      "%s com valor zero é inválido",
      (kind) => {
        expect(() => bet({ kind, money: Money.zero("BRL"), ...referenceFor(kind) })).toThrow(
          InvalidWagerTransactionError,
        );
      },
    );

    test("valor negativo é inválido", () => {
      expect(() => bet({ money: brl("1.00").negate() })).toThrow(InvalidWagerTransactionError);
    });

    test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
      "%s exige referenceExternalTransactionId",
      (kind) => {
        expect(() => bet({ kind })).toThrow(InvalidWagerTransactionError);
        expect(() => bet({ kind, referenceExternalTransactionId: "" })).toThrow(InvalidWagerTransactionError);
        expect(bet({ kind, referenceExternalTransactionId: "ext-0" }).requiresReference()).toBe(true);
      },
    );

    test.each([WagerTransactionKind.Bet, WagerTransactionKind.Loss])(
      "%s não referencia nada: referenceExternalTransactionId é inválido",
      (kind) => {
        expect(() => bet({ kind, referenceExternalTransactionId: "ext-0" })).toThrow(InvalidWagerTransactionError);
        expect(bet({ kind }).referenceExternalTransactionId).toBeUndefined();
      },
    );

    test("WIN pode referenciar a BET da rodada, mas não exige", () => {
      expect(bet({ kind: WagerTransactionKind.Win }).requiresReference()).toBe(false);
      const win = bet({ kind: WagerTransactionKind.Win, referenceExternalTransactionId: "ext-0" });
      expect(win.referenceExternalTransactionId).toBe("ext-0");
    });
  });

  describe("consultas", () => {
    test.each([
      [WagerTransactionKind.Bet, true],
      [WagerTransactionKind.Win, true],
      [WagerTransactionKind.Loss, false],
      [WagerTransactionKind.Refund, true],
      [WagerTransactionKind.Rollback, true],
    ])("%s affectsBalance = %p", (kind, expected) => {
      expect(bet({ kind, ...referenceFor(kind) }).affectsBalance()).toBe(expected);
    });

    test("matchesPayload compara o hash do payload", () => {
      const tx = bet({ payloadHash: "abc" });
      expect(tx.matchesPayload("abc")).toBe(true);
      expect(tx.matchesPayload("abd")).toBe(false);
    });
  });

  describe("transições", () => {
    test("PENDING → PROCESSED grava saldo observado e data", () => {
      const tx = bet();
      tx.markProcessed({ at, observedBalance: brl("75.00"), referenceTransactionId: undefined });
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.observedBalance?.equals(brl("75.00"))).toBe(true);
      expect(tx.processedAt).toEqual(at);
      expect(tx.isTerminal()).toBe(true);
    });

    test("LOSS processado guarda o saldo observado, que não mudou", () => {
      const tx = bet({ kind: WagerTransactionKind.Loss });
      tx.markProcessed({ at, observedBalance: brl("100.00"), referenceTransactionId: undefined });
      expect(tx.observedBalance?.equals(brl("100.00"))).toBe(true);
    });

    test("PENDING → REJECTED grava failureCode e saldo observado", () => {
      const tx = bet();
      tx.reject({ code: FailureCode.InsufficientFunds, at, observedBalance: brl("10.00") });
      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(tx.observedBalance?.equals(brl("10.00"))).toBe(true);
      expect(tx.processedAt).toEqual(at);
      expect(tx.referenceTransactionId).toBeUndefined();
    });

    test("reversão rejeitada mantém o vínculo com a referência para auditoria", () => {
      const tx = reversal(WagerTransactionKind.Refund, { money: brl("10.00") });
      tx.reject({
        code: FailureCode.ReversalAmountMismatch,
        at,
        observedBalance: brl("100.00"),
        referenceTransactionId: "tx-1",
      });
      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.referenceTransactionId).toBe("tx-1");
    });

    test("PENDING → FAILED grava o código", () => {
      const tx = bet();
      tx.fail({ code: FailureCode.InsufficientFunds, at });
      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(tx.isTerminal()).toBe(true);
    });

    test("PENDING → PENDING_REFERENCE → PENDING_REFERENCE → PROCESSED", () => {
      const tx = reversal(WagerTransactionKind.Refund);
      tx.markPendingReference();
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);
      tx.markPendingReference();
      tx.markProcessed({ at, observedBalance: brl("100.00"), referenceTransactionId: "tx-1" });
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe("tx-1");
    });

    test.each([
      [
        "REJECTED",
        (tx: WagerTransaction) => tx.reject({ code: FailureCode.ReferenceNotFound, at, observedBalance: brl("1.00") }),
      ],
      ["FAILED", (tx: WagerTransaction) => tx.fail({ code: FailureCode.ReferenceNotFound, at })],
    ])("PENDING_REFERENCE → %s", (_label, transition) => {
      const tx = reversal(WagerTransactionKind.Refund);
      tx.markPendingReference();
      transition(tx);
      expect(tx.isTerminal()).toBe(true);
    });

    test("reversão processada exige o id interno da referência", () => {
      const tx = reversal(WagerTransactionKind.Rollback);
      expect(() => tx.markProcessed({ at, observedBalance: brl("1.00"), referenceTransactionId: undefined })).toThrow(
        InvalidWagerTransactionError,
      );
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
    });

    test("só REFUND e ROLLBACK podem esperar referência", () => {
      expect(() => bet().markPendingReference()).toThrow(InvalidTransactionStateError);
    });

    const terminalTransitions: [string, (tx: WagerTransaction) => void][] = [
      ["markProcessed", (tx) => tx.markProcessed({ at, observedBalance: brl("1.00"), referenceTransactionId: "tx-0" })],
      ["markPendingReference", (tx) => tx.markPendingReference()],
      ["reject", (tx) => tx.reject({ code: FailureCode.InsufficientFunds, at, observedBalance: brl("1.00") })],
      ["fail", (tx) => tx.fail({ code: FailureCode.InsufficientFunds, at })],
    ];

    const terminalStates: [string, (tx: WagerTransaction) => void][] = [
      ["PROCESSED", (tx) => tx.markProcessed({ at, observedBalance: brl("1.00"), referenceTransactionId: "tx-1" })],
      ["REJECTED", (tx) => tx.reject({ code: FailureCode.ReferenceNotFound, at, observedBalance: brl("1.00") })],
      ["FAILED", (tx) => tx.fail({ code: FailureCode.ReferenceNotFound, at })],
    ];

    for (const [state, finish] of terminalStates) {
      for (const [name, transition] of terminalTransitions) {
        test(`${state} é terminal: ${name} lança InvalidTransactionStateError e não muda nada`, () => {
          const tx = reversal(WagerTransactionKind.Refund);
          finish(tx);
          const snapshot = () => ({ status: tx.status, failureCode: tx.failureCode, processedAt: tx.processedAt });
          const before = snapshot();

          const error = captureError(() => transition(tx));

          expect(error).toBeInstanceOf(InvalidTransactionStateError);
          expect(error).not.toBeInstanceOf(BusinessRuleError);
          expect(snapshot()).toEqual(before);
        });
      }
    }
  });

  describe("ledgerDirectionFor", () => {
    test.each([
      [WagerTransactionKind.Bet, LedgerDirection.Debit],
      [WagerTransactionKind.Win, LedgerDirection.Credit],
      [WagerTransactionKind.Refund, LedgerDirection.Credit],
    ])("%s → %s", (kind, direction) => {
      expect(bet({ kind, ...referenceFor(kind) }).ledgerDirectionFor()).toBe(direction);
    });

    test.each([
      [WagerTransactionKind.Bet, LedgerDirection.Credit],
      [WagerTransactionKind.Win, LedgerDirection.Debit],
      [WagerTransactionKind.Refund, LedgerDirection.Debit],
    ])("ROLLBACK de %s → %s", (referenceKind, direction) => {
      const reference = processed({ kind: referenceKind, ...referenceFor(referenceKind) });
      expect(reversal(WagerTransactionKind.Rollback).ledgerDirectionFor(reference)).toBe(direction);
    });

    test("LOSS não tem direção", () => {
      expect(() => bet({ kind: WagerTransactionKind.Loss }).ledgerDirectionFor()).toThrow(InvalidWagerTransactionError);
    });

    test("ROLLBACK sem referência não tem direção", () => {
      expect(() => reversal(WagerTransactionKind.Rollback).ledgerDirectionFor()).toThrow(InvalidWagerTransactionError);
    });
  });

  describe("validateReversalOf", () => {
    test("REFUND de BET processada da mesma rodada e valor é válido", () => {
      expect(() => reversal(WagerTransactionKind.Refund).validateReversalOf(processed())).not.toThrow();
    });

    test.each([WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund])(
      "ROLLBACK de %s processado é válido",
      (kind) => {
        const reference = processed({ kind, ...referenceFor(kind) });
        expect(() => reversal(WagerTransactionKind.Rollback).validateReversalOf(reference)).not.toThrow();
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
        () => reversal(WagerTransactionKind.Refund).validateReversalOf(processed(overrides)),
        FailureCode.ReferenceMismatch,
      );
    });

    test.each([WagerTransactionKind.Win, WagerTransactionKind.Loss, WagerTransactionKind.Refund])(
      "REFUND de %s → INVALID_REFERENCE_KIND",
      (kind) => {
        const reference = processed({ kind, ...referenceFor(kind) });
        expectViolation(
          () => reversal(WagerTransactionKind.Refund).validateReversalOf(reference),
          FailureCode.InvalidReferenceKind,
        );
      },
    );

    test.each([WagerTransactionKind.Loss, WagerTransactionKind.Rollback])(
      "ROLLBACK de %s → INVALID_REFERENCE_KIND",
      (kind) => {
        const reference = processed({ kind, ...referenceFor(kind) });
        expectViolation(
          () => reversal(WagerTransactionKind.Rollback).validateReversalOf(reference),
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
        () => reversal(WagerTransactionKind.Refund).validateReversalOf(reference),
        FailureCode.ReferenceNotProcessed,
      );
    });

    test("valor diferente da referência → REVERSAL_AMOUNT_MISMATCH", () => {
      expectViolation(
        () => reversal(WagerTransactionKind.Refund, { money: brl("10.00") }).validateReversalOf(processed()),
        FailureCode.ReversalAmountMismatch,
      );
    });

    test("referência ainda não terminal é erro de programação: o chamador deve esperar", () => {
      const error = captureError(() => reversal(WagerTransactionKind.Refund).validateReversalOf(bet()));
      expect(error).toBeInstanceOf(InvalidWagerTransactionError);
      expect(error).not.toBeInstanceOf(BusinessRuleError);
    });

    test("referência com outro externalTransactionId é erro de programação", () => {
      const refund = reversal(WagerTransactionKind.Refund, { referenceExternalTransactionId: "ext-9" });
      expect(() => refund.validateReversalOf(processed())).toThrow(InvalidWagerTransactionError);
    });

    test("só REFUND e ROLLBACK revertem", () => {
      expect(() => bet({ kind: WagerTransactionKind.Win }).validateReversalOf(processed())).toThrow(
        InvalidWagerTransactionError,
      );
    });
  });

  describe("estado isolado", () => {
    test("alterar o Date de origem ou o devolvido não muda a transação", () => {
      const createdSource = new Date("2026-11-09T12:00:00.000Z");
      const processedSource = new Date("2026-11-09T12:00:01.000Z");
      const tx = bet({ createdAt: createdSource });
      tx.markProcessed({ at: processedSource, observedBalance: brl("75.00"), referenceTransactionId: undefined });

      createdSource.setUTCFullYear(1999);
      processedSource.setUTCFullYear(1999);
      tx.createdAt.setUTCFullYear(1998);
      tx.processedAt?.setUTCFullYear(1998);

      expect(tx.createdAt.toISOString()).toBe("2026-11-09T12:00:00.000Z");
      expect(tx.processedAt?.toISOString()).toBe("2026-11-09T12:00:01.000Z");
    });

    test("alterar os objetos provider e game de origem não muda a transação", () => {
      const provider = { providerId: "provider-a", externalTransactionId: "ext-1" };
      const game = { roundId: "round-1", gameId: "game-1" };
      const tx = bet({ provider, game });

      provider.externalTransactionId = "ext-hijacked";
      game.roundId = "round-hijacked";

      expect(tx.provider.externalTransactionId).toBe("ext-1");
      expect(tx.game.roundId).toBe("round-1");
    });
  });

  describe("rehydrate", () => {
    test("reconstrói estado terminal sem revalidar transições", () => {
      const tx = WagerTransaction.rehydrate({
        ...props({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: "ext-0" }),
        outcome: {
          status: WagerTransactionStatus.Rejected,
          referenceTransactionId: undefined,
          failureCode: FailureCode.ReferenceNotFound,
          observedBalance: brl("3.00"),
          processedAt: at,
        },
      });
      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
      expect(tx.observedBalance?.equals(brl("3.00"))).toBe(true);
      expect(() => tx.markPendingReference()).toThrow(InvalidTransactionStateError);
    });
  });
});
