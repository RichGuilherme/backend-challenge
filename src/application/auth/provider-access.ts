import type { ProviderIdentity } from "../ports/token-verifier";
import { ProviderForbiddenError } from "./auth.errors";

export function assertProviderAccess(caller: ProviderIdentity | undefined, providerId: string): void {
  if (caller && caller.providerId !== providerId) throw new ProviderForbiddenError(caller.providerId, providerId);
}
