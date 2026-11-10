import type { SubmitWagerTransactionCommand } from "../../src/application/wagering/submit-wager-transaction.use-case";
import { WagerTransactionKind } from "../../src/domain/wagering/wager-transaction-kind";

export function submitCommand(
  walletId: string,
  playerId: string,
  overrides: Partial<SubmitWagerTransactionCommand> = {},
): SubmitWagerTransactionCommand {
  const externalTransactionId = overrides.externalTransactionId ?? `ext-${crypto.randomUUID()}`;
  const providerId = overrides.providerId ?? "provider-a";
  return {
    providerId,
    externalTransactionId,
    idempotencyKey: `${providerId}:${externalTransactionId}`,
    playerId,
    walletId,
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: { amount: "25.00", currency: "BRL" },
    referenceExternalTransactionId: undefined,
    correlationId: "test-correlation",
    ...overrides,
  };
}
