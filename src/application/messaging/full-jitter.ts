export interface BackoffPolicy {
  baseMs: number;
  capMs: number;
}

export type RandomSource = () => number;

export function fullJitterDelayMs(attempt: number, policy: BackoffPolicy, random: RandomSource): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Tentativa deve ser inteiro positivo: ${attempt}`);
  }
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}
