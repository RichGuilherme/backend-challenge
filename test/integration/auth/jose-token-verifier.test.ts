import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { InvalidTokenError } from "../../../src/application/auth/auth.errors";
import { TransientFailureError } from "../../../src/application/shared/application-error";
import { JoseTokenVerifier } from "../../../src/infrastructure/auth/jose-token-verifier";
import { FakeIdentityProvider, foreignSigningKey } from "../../support/identity-provider";

let idp: FakeIdentityProvider;
let verifier: JoseTokenVerifier;

beforeAll(async () => {
  idp = await FakeIdentityProvider.start();
  verifier = new JoseTokenVerifier(idp.config);
});

afterAll(() => idp?.stop());

describe("JoseTokenVerifier", () => {
  test("token válido devolve o provedor a partir da claim azp", async () => {
    const identity = await verifier.verify(await idp.issue({ clientId: "provider-b" }));
    expect(identity).toEqual({ providerId: "provider-b" });
  });

  test("tolera pequena diferença de relógio com o emissor", async () => {
    const identity = await verifier.verify(await idp.issue({ expiresInSeconds: -2 }));
    expect(identity).toEqual({ providerId: "provider-a" });
  });

  test.each<[string, () => Promise<string>]>([
    ["expirado", () => idp.issue({ expiresInSeconds: -60 })],
    ["emissor diferente", () => idp.issue({ issuer: "http://outro-emissor/realms/x" })],
    ["audiência diferente", () => idp.issue({ audience: "outra-api" })],
    ["assinado por outra chave", async () => idp.issue({ signWith: await foreignSigningKey() })],
    ["sem a claim azp", () => idp.issue({ withoutAuthorizedParty: true })],
    ["azp vazio", () => idp.issue({ clientId: "" })],
    ["assinado com algoritmo fora da allowlist (RS384)", () => idp.issue({ algorithm: "RS384" })],
    ["expirado há muito além da tolerância de relógio", () => idp.issue({ expiresInSeconds: -30 })],
    ["lixo que não é JWT", async () => "isto-nao-e-um-jwt"],
    [
      "HS256 assinado com segredo (ataque de confusão de algoritmo)",
      async () =>
        new SignJWT({ azp: "provider-a" })
          .setProtectedHeader({ alg: "HS256", kid: "test-key-rs256" })
          .setIssuer(idp.issuer)
          .setAudience(idp.config.audience)
          .setExpirationTime("5m")
          .sign(new TextEncoder().encode("segredo-qualquer-com-32-bytes-ou-mais!!")),
    ],
  ])("rejeita token %s com InvalidTokenError", async (_label, issue) => {
    await expect(verifier.verify(await issue())).rejects.toBeInstanceOf(InvalidTokenError);
  });

  test("IdP indisponível sem chaves em cache é falha transitória, não 401", async () => {
    const unreachable = new JoseTokenVerifier({ ...idp.config, jwksUri: "http://127.0.0.1:1/certs" });
    await expect(unreachable.verify(await idp.issue())).rejects.toBeInstanceOf(TransientFailureError);
  });

  test("com as chaves em cache, continua validando mesmo com o IdP fora do ar", async () => {
    const provider = await FakeIdentityProvider.start();
    const cached = new JoseTokenVerifier(provider.config);
    await cached.verify(await provider.issue());

    const token = await provider.issue({ clientId: "provider-a" });
    await provider.stop();

    expect(await cached.verify(token)).toEqual({ providerId: "provider-a" });
  });
});
