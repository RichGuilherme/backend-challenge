import { ApplicationError } from "../shared/application-error";

export class InvalidTokenError extends ApplicationError {}

export class ProviderForbiddenError extends ApplicationError {
  constructor(
    readonly authenticatedProviderId: string,
    readonly requestedProviderId: string,
  ) {
    super(`O token autoriza o provedor ${authenticatedProviderId}, não ${requestedProviderId}`);
  }
}
