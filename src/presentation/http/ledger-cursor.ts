import { InvalidPayloadError } from "./invalid-payload.error";

const START_OF_LEDGER = 0;

export function encodeLedgerCursor(afterVersion: number): string {
  return Buffer.from(JSON.stringify({ v: afterVersion })).toString("base64url");
}

export function decodeLedgerCursor(cursor: string | undefined): number {
  if (cursor === undefined) return START_OF_LEDGER;
  const afterVersion = readVersion(cursor);
  if (afterVersion === undefined) {
    throw new InvalidPayloadError([{ path: "cursor", message: "Cursor inválido" }]);
  }
  return afterVersion;
}

function readVersion(cursor: string): number | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || !("v" in decoded)) return undefined;
    const { v } = decoded;
    return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined;
  } catch {
    return undefined;
  }
}
