import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";

export const TEST_AUDIENCE = "wagering-api";

export interface IssueOptions {
  clientId?: string | undefined;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  signWith?: CryptoKey;
  withoutAuthorizedParty?: boolean;
  algorithm?: "RS256" | "RS384";
}

export interface IdentityProviderConfig {
  issuer: string;
  jwksUri: string;
  audience: string;
}

export class FakeIdentityProvider {
  private constructor(
    private readonly server: ReturnType<typeof Bun.serve>,
    private readonly signingKeys: Record<"RS256" | "RS384", CryptoKey>,
    readonly issuer: string,
  ) {}

  static async start(): Promise<FakeIdentityProvider> {
    const rs256 = await generateKeyPair("RS256");
    const rs384 = await generateKeyPair("RS384");
    const keys: JWK[] = [
      { ...(await exportJWK(rs256.publicKey)), kid: "test-key-rs256", use: "sig" },
      { ...(await exportJWK(rs384.publicKey)), kid: "test-key-rs384", use: "sig" },
    ];
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/certs"
          ? Response.json({ keys })
          : new Response("not found", { status: 404 }),
    });
    return new FakeIdentityProvider(
      server,
      { RS256: rs256.privateKey, RS384: rs384.privateKey },
      `http://127.0.0.1:${server.port}/realms/test`,
    );
  }

  get config(): IdentityProviderConfig {
    return { issuer: this.issuer, jwksUri: `http://127.0.0.1:${this.server.port}/certs`, audience: TEST_AUDIENCE };
  }

  async issue(options: IssueOptions = {}): Promise<string> {
    const claims = options.withoutAuthorizedParty
      ? {}
      : { azp: "clientId" in options ? options.clientId : "provider-a" };
    const algorithm = options.algorithm ?? "RS256";
    return new SignJWT(claims)
      .setProtectedHeader({ alg: algorithm, kid: `test-key-${algorithm.toLowerCase()}` })
      .setIssuer(options.issuer ?? this.issuer)
      .setAudience(options.audience ?? TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${options.expiresInSeconds ?? 300}s`)
      .sign(options.signWith ?? this.signingKeys[algorithm]);
  }

  async stop(): Promise<void> {
    await this.server.stop(true);
  }
}

export async function foreignSigningKey(): Promise<CryptoKey> {
  return (await generateKeyPair("RS256")).privateKey;
}
