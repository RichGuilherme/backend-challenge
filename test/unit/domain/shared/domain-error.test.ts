import { describe, expect, test } from "bun:test";
import { DomainError } from "../../../../src/domain/shared/domain-error";
import { BusinessRuleError } from "../../../../src/domain/shared/business-rule.error";

class ProgrammingError extends DomainError {}
class RuleRejection extends BusinessRuleError {}

describe("DomainError", () => {
  test("name é o nome da classe concreta, sem declaração manual", () => {
    expect(new ProgrammingError("x").name).toBe("ProgrammingError");
    expect(new RuleRejection("x").name).toBe("RuleRejection");
  });

  test("recusa de negócio é DomainError e BusinessRuleError; bug é só DomainError", () => {
    const rejection = new RuleRejection("x");
    const bug = new ProgrammingError("x");

    expect(rejection).toBeInstanceOf(DomainError);
    expect(rejection).toBeInstanceOf(BusinessRuleError);
    expect(bug).toBeInstanceOf(DomainError);
    expect(bug).not.toBeInstanceOf(BusinessRuleError);
  });

  test("preserva a mensagem e a pilha de Error", () => {
    const rejection = new RuleRejection("saldo insuficiente");
    expect(rejection.message).toBe("saldo insuficiente");
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection.stack).toContain("RuleRejection");
  });
});
