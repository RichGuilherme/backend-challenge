export const TOKEN_VERIFIER = Symbol("TokenVerifier");

export interface ProviderIdentity {
  providerId: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<ProviderIdentity>;
}
