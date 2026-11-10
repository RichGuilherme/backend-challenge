import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PENDING_REFERENCE_POLICY,
  PendingReference,
} from "../../../../src/application/wagering/pending-reference";

const createdAt = new Date("2026-11-10T12:00:00.000Z");
const plus = (ms: number) => new Date(createdAt.getTime() + ms);
const policy = { ttlMs: 60_000, backoff: { baseMs: 2_000, capMs: 600_000 } };
const half = () => 0.5;

describe("PendingReference", () => {
  test("a política padrão é a decidida: TTL 24h, base 2s, teto 10min", () => {
    expect(DEFAULT_PENDING_REFERENCE_POLICY).toEqual({
      ttlMs: 24 * 60 * 60 * 1_000,
      backoff: { baseMs: 2_000, capMs: 600_000 },
    });
  });

  test("schedule agenda a primeira tentativa com jitter e fixa a expiração pelo TTL", () => {
    const pending = PendingReference.schedule("tx-1", createdAt, policy, half);

    expect(pending.transactionId).toBe("tx-1");
    expect(pending.attempts).toBe(0);
    expect(pending.nextAttemptAt).toEqual(plus(2_000));
    expect(pending.expiresAt).toEqual(plus(60_000));
    expect(pending.isDue(plus(1_999))).toBe(false);
    expect(pending.isDue(plus(2_000))).toBe(true);
  });

  test("reschedule conta a tentativa e espera mais a cada vez", () => {
    const pending = PendingReference.schedule("tx-1", createdAt, policy, half);

    pending.reschedule(plus(2_000), policy, half);
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt).toEqual(plus(2_000 + 4_000));

    pending.reschedule(plus(6_000), policy, half);
    expect(pending.attempts).toBe(2);
    expect(pending.nextAttemptAt).toEqual(plus(6_000 + 8_000));
  });

  test("a próxima tentativa nunca passa da expiração", () => {
    const pending = PendingReference.schedule("tx-1", createdAt, policy, half);
    pending.reschedule(plus(59_000), { ...policy, backoff: { baseMs: 2_000, capMs: 600_000 } }, () => 0.99);
    expect(pending.nextAttemptAt).toEqual(plus(60_000));
  });

  test("isExpired a partir do instante de expiração", () => {
    const pending = PendingReference.schedule("tx-1", createdAt, policy, half);
    expect(pending.isExpired(plus(59_999))).toBe(false);
    expect(pending.isExpired(plus(60_000))).toBe(true);
  });
});
