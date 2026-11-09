import { createHash } from "node:crypto";
import { Money, type MoneyProps } from "../../domain/shared/money/money";

export interface WagerTransactionPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string | undefined;
}

type CanonicalValue = string | null | { [key: string]: CanonicalValue };

export function computePayloadHash(payload: WagerTransactionPayload): string {
  const businessFields: CanonicalValue = {
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    playerId: payload.playerId,
    walletId: payload.walletId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: { ...Money.from(payload.money).toJSON() },
    referenceExternalTransactionId: payload.referenceExternalTransactionId ?? null,
  };
  return createHash("sha256").update(canonicalJson(businessFields)).digest("hex");
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "string") return JSON.stringify(value);
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`);
  return `{${entries.join(",")}}`;
}
