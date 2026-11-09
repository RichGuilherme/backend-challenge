export interface PayloadIssue {
  path: string;
  message: string;
}

export class InvalidPayloadError extends Error {
  override readonly name = "InvalidPayloadError";

  constructor(readonly issues: readonly PayloadIssue[]) {
    super("Payload inválido");
  }
}
