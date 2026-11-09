import { ApplicationError } from "../shared/application-error";

export class WalletNotFoundError extends ApplicationError {
  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} não encontrada`);
  }
}

export class WalletAlreadyExistsError extends ApplicationError {
  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`Já existe wallet ${currency} para o player ${playerId}`);
  }
}

export class WalletPlayerMismatchError extends ApplicationError {
  constructor(
    readonly walletId: string,
    readonly playerId: string,
  ) {
    super(`Wallet ${walletId} não pertence ao player ${playerId}`);
  }
}
