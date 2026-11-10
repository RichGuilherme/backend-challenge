import { WagerTransaction, type CreateWagerTransactionProps } from "../../src/domain/wagering/wager-transaction";
import { WagerTransactionKind } from "../../src/domain/wagering/wager-transaction-kind";
import { brl } from "./money";

const createdAt = new Date("2026-11-09T12:00:00.000Z");

export function buildWagerTransaction(overrides: Partial<CreateWagerTransactionProps> = {}): WagerTransaction {
  const externalTransactionId = overrides.provider?.externalTransactionId ?? "ext-bet";
  return WagerTransaction.create({
    id: `tx-${externalTransactionId}`,
    provider: { providerId: "provider-a", externalTransactionId },
    idempotencyKey: `provider-a:${externalTransactionId}`,
    payloadHash: `hash-${externalTransactionId}`,
    walletId: "wallet-1",
    playerId: "player-1",
    game: { roundId: "round-1", gameId: "game-1" },
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    referenceExternalTransactionId: undefined,
    createdAt,
    ...overrides,
  });
}

export function externalId(externalTransactionId: string): Pick<CreateWagerTransactionProps, "provider"> {
  return { provider: { providerId: "provider-a", externalTransactionId } };
}
