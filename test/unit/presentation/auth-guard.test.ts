import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InvalidTokenError } from "../../../src/application/auth/auth.errors";
import type { ProviderIdentity, TokenVerifier } from "../../../src/application/ports/token-verifier";
import { AuthGuard, IS_PUBLIC, Public } from "../../../src/presentation/http/auth.guard";
import { OpsController } from "../../../src/presentation/http/ops.controller";
import { WageringTransactionsController } from "../../../src/presentation/http/wagering-transactions.controller";
import { WalletsController } from "../../../src/presentation/http/wallets.controller";

class PlainController {
  handle(): void {}
}

@Public()
class OpenController {
  handle(): void {}
}

interface FakeRequest {
  headers: Record<string, string | undefined>;
  caller?: ProviderIdentity;
}

function contextOf(controller: new () => { handle(): void }, request: FakeRequest = { headers: {} }): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => controller.prototype.handle,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function recordingVerifier(identity: ProviderIdentity = { providerId: "provider-a" }) {
  const tokens: string[] = [];
  const verifier: TokenVerifier = {
    async verify(token) {
      tokens.push(token);
      if (token === "ruim") throw new InvalidTokenError("Token inválido");
      return identity;
    },
  };
  return { verifier, tokens };
}

describe("AuthGuard", () => {
  describe("autenticação desligada (sem verificador)", () => {
    const guard = new AuthGuard(new Reflector(), null);

    test("libera rotas protegidas e públicas, sem exigir token nem preencher o chamador", async () => {
      const request: FakeRequest = { headers: {} };

      expect(await guard.canActivate(contextOf(PlainController, request))).toBe(true);
      expect(await guard.canActivate(contextOf(OpenController, request))).toBe(true);
      expect(request.caller).toBeUndefined();
    });
  });

  describe("autenticação ligada", () => {
    test("rota protegida: valida o token Bearer e guarda o chamador na requisição", async () => {
      const { verifier, tokens } = recordingVerifier({ providerId: "provider-z" });
      const request: FakeRequest = { headers: { authorization: "Bearer abc.def.ghi" } };

      const allowed = await new AuthGuard(new Reflector(), verifier).canActivate(contextOf(PlainController, request));

      expect(allowed).toBe(true);
      expect(tokens).toEqual(["abc.def.ghi"]);
      expect(request.caller).toEqual({ providerId: "provider-z" });
    });

    test("aceita o esquema Bearer em qualquer caixa", async () => {
      const { verifier, tokens } = recordingVerifier();
      await new AuthGuard(new Reflector(), verifier).canActivate(
        contextOf(PlainController, { headers: { authorization: "bearer token-1" } }),
      );
      expect(tokens).toEqual(["token-1"]);
    });

    test("rota pública não consulta o verificador", async () => {
      const { verifier, tokens } = recordingVerifier();

      const allowed = await new AuthGuard(new Reflector(), verifier).canActivate(contextOf(OpenController));

      expect(allowed).toBe(true);
      expect(tokens).toEqual([]);
    });

    test.each<[string, string | undefined]>([
      ["sem header", undefined],
      ["esquema Basic", "Basic dXNlcjpzZW5oYQ=="],
      ["Bearer vazio", "Bearer "],
      ["só a palavra Bearer", "Bearer"],
      ["token com espaço no meio", "Bearer a b"],
    ])("%s → InvalidTokenError sem chamar o verificador", async (_label, header) => {
      const { verifier, tokens } = recordingVerifier();
      const request: FakeRequest = { headers: header === undefined ? {} : { authorization: header } };

      await expect(
        new AuthGuard(new Reflector(), verifier).canActivate(contextOf(PlainController, request)),
      ).rejects.toBeInstanceOf(InvalidTokenError);
      expect(tokens).toEqual([]);
    });

    test("propaga a rejeição do verificador", async () => {
      const { verifier } = recordingVerifier();
      const request: FakeRequest = { headers: { authorization: "Bearer ruim" } };

      await expect(
        new AuthGuard(new Reflector(), verifier).canActivate(contextOf(PlainController, request)),
      ).rejects.toBeInstanceOf(InvalidTokenError);
      expect(request.caller).toBeUndefined();
    });
  });

  test("health e métricas são públicas por contrato; a API financeira não", () => {
    const isPublic = (target: object) => Reflect.getMetadata(IS_PUBLIC, target) === true;

    expect(isPublic(OpsController)).toBe(true);
    expect(isPublic(WalletsController)).toBe(false);
    expect(isPublic(WageringTransactionsController)).toBe(false);
  });
});
