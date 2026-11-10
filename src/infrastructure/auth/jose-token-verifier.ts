import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { InvalidTokenError } from "../../application/auth/auth.errors";
import type { ProviderIdentity, TokenVerifier } from "../../application/ports/token-verifier";
import { TransientFailureError } from "../../application/shared/application-error";

export interface JoseTokenVerifierConfig {
  issuer: string;
  jwksUri: string;
  audience: string;
}

const ALLOWED_ALGORITHMS = ["RS256"];
const CLOCK_TOLERANCE_SECONDS = 5;
const JWKS_TIMEOUT_MS = 2_000;
const JWKS_COOLDOWN_MS = 30_000;
const JWKS_CACHE_MAX_AGE_MS = 600_000;

export class JoseTokenVerifier implements TokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: JoseTokenVerifierConfig) {
    this.keys = createRemoteJWKSet(new URL(config.jwksUri), {
      timeoutDuration: JWKS_TIMEOUT_MS,
      cooldownDuration: JWKS_COOLDOWN_MS,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    });
  }

  async verify(token: string): Promise<ProviderIdentity> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ALLOWED_ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      return { providerId: providerIdOf(payload.azp) };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      if (isIdentityProviderFailure(error)) throw new TransientFailureError("Provedor de identidade indisponível");
      throw new InvalidTokenError("Token inválido");
    }
  }
}

function providerIdOf(authorizedParty: unknown): string {
  if (typeof authorizedParty !== "string" || authorizedParty.length === 0) {
    throw new InvalidTokenError("Token sem a claim azp");
  }
  return authorizedParty;
}

function isIdentityProviderFailure(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout) return true;
  if (error instanceof errors.JOSEError) return error.code === "ERR_JOSE_GENERIC";
  return true;
}
