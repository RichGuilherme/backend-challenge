import { ApplicationError } from "../shared/application-error";

export class IdempotencyConflictError extends ApplicationError {
  constructor(
    readonly idempotencyKey: string,
    readonly reason: "PAYLOAD_MISMATCH" | "KEY_MISMATCH",
  ) {
    super(
      reason === "PAYLOAD_MISMATCH"
        ? `Idempotency-Key ${idempotencyKey} já usada com outro payload`
        : `Transação do provedor já registrada com outra Idempotency-Key (recebida: ${idempotencyKey})`,
    );
  }
}

export class WagerTransactionNotFoundError extends ApplicationError {
  constructor(readonly reference: string) {
    super(`Transação ${reference} não encontrada`);
  }
}
