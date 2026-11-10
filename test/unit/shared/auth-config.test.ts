import { describe, expect, test } from "bun:test";
import { loadAuthConfig } from "../../../src/shared/config/env";

const complete = {
  AUTH_ENABLED: "true",
  AUTH_ISSUER: "http://idp/realms/wagering",
  AUTH_JWKS_URI: "http://idp/realms/wagering/protocol/openid-connect/certs",
  AUTH_AUDIENCE: "wagering-api",
};

describe("loadAuthConfig", () => {
  test("sem AUTH_ENABLED a autenticação fica desligada e nada mais é exigido", () => {
    expect(loadAuthConfig({})).toEqual({ enabled: false });
    expect(loadAuthConfig({ AUTH_ENABLED: "false" })).toEqual({ enabled: false });
  });

  test("ligada, lê emissor, JWKS e audiência", () => {
    expect(loadAuthConfig(complete)).toEqual({
      enabled: true,
      issuer: complete.AUTH_ISSUER,
      jwksUri: complete.AUTH_JWKS_URI,
      audience: complete.AUTH_AUDIENCE,
    });
  });

  test.each(["AUTH_ISSUER", "AUTH_JWKS_URI", "AUTH_AUDIENCE"])("ligada sem %s falha no boot", (missing) => {
    const env: Record<string, string> = { ...complete };
    delete env[missing];
    expect(() => loadAuthConfig(env)).toThrow(missing);
  });

  test("valor inválido em AUTH_ENABLED falha em vez de desligar a autenticação em silêncio", () => {
    expect(() => loadAuthConfig({ AUTH_ENABLED: "talvez" })).toThrow("AUTH_ENABLED");
  });
});
