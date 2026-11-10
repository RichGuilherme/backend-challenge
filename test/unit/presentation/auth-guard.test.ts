import { describe, expect, test } from "bun:test";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
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

function contextOf(controller: new () => { handle(): void }): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => controller.prototype.handle,
  } as unknown as ExecutionContext;
}

describe("AuthGuard", () => {
  const guard = new AuthGuard(new Reflector());

  test("é o ponto de extensão: hoje libera rotas protegidas e públicas", () => {
    expect(guard.canActivate(contextOf(PlainController))).toBe(true);
    expect(guard.canActivate(contextOf(OpenController))).toBe(true);
  });

  test("health e métricas são públicas por contrato; a API financeira não", () => {
    const isPublic = (target: object) => Reflect.getMetadata(IS_PUBLIC, target) === true;

    expect(isPublic(OpsController)).toBe(true);
    expect(isPublic(WalletsController)).toBe(false);
    expect(isPublic(WageringTransactionsController)).toBe(false);
  });
});
