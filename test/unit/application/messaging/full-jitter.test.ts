import { describe, expect, test } from "bun:test";
import { fullJitterDelayMs } from "../../../../src/application/messaging/full-jitter";

const policy = { baseMs: 1_000, capMs: 300_000 };

describe("fullJitterDelayMs", () => {
  test.each([
    [1, 0.5, 1_000],
    [2, 0.5, 2_000],
    [3, 0.5, 4_000],
    [5, 0.25, 8_000],
  ])("tentativa %i com sorteio %d → %i ms (metade do teto exponencial)", (attempt, random, expected) => {
    expect(fullJitterDelayMs(attempt, policy, () => random)).toBe(expected);
  });

  test("o sorteio cobre de 0 até o teto exponencial", () => {
    expect(fullJitterDelayMs(3, policy, () => 0)).toBe(0);
    expect(fullJitterDelayMs(3, policy, () => 0.999_999)).toBeLessThan(8_000);
  });

  test("o teto limita o crescimento, mesmo em tentativas altas", () => {
    expect(fullJitterDelayMs(30, policy, () => 0.999_999)).toBeLessThan(300_000);
    expect(fullJitterDelayMs(1_000, policy, () => 0.5)).toBe(150_000);
  });

  test("tentativa precisa ser inteiro positivo", () => {
    expect(() => fullJitterDelayMs(0, policy, () => 0.5)).toThrow();
    expect(() => fullJitterDelayMs(1.5, policy, () => 0.5)).toThrow();
  });
});
