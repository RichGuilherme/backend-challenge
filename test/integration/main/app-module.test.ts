import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { SubmitWagerTransactionUseCase } from "../../../src/application/wagering/submit-wager-transaction.use-case";
import { GetWalletUseCase } from "../../../src/application/wallet/get-wallet.use-case";
import { OpenWalletUseCase } from "../../../src/application/wallet/open-wallet.use-case";
import { AppModule } from "../../../src/main/app.module";
import { createTestContext, type TestContext } from "../../support/application";
import { submitCommand } from "../../support/commands";
import { testDatabaseConfig } from "../../support/database";
import { expectWalletMatchesLedger } from "../../support/ledger-invariant";

let context: TestContext;
let app: INestApplicationContext;
const originalDbName = process.env.DB_NAME;

beforeAll(async () => {
  context = await createTestContext();
  process.env.DB_NAME = testDatabaseConfig().name;
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
});

afterAll(async () => {
  await app?.close();
  process.env.DB_NAME = originalDbName;
  await context?.close();
});

describe("AppModule", () => {
  test("monta os casos de uso com UnitOfWork, ids e relógio reais", async () => {
    const wallet = await app
      .get(OpenWalletUseCase)
      .execute({ playerId: `player-${crypto.randomUUID()}`, correlationId: "test-correlation", initialBalance: { amount: "100.00", currency: "BRL" } });

    const result = await app.get(SubmitWagerTransactionUseCase).execute(submitCommand(wallet.id, wallet.playerId));

    expect(result.balance).toEqual({ amount: "75.00", currency: "BRL" });
    expect(result.transactionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await app.get(GetWalletUseCase).execute(wallet.id)).version).toBe(2);
    await expectWalletMatchesLedger(context.sql, wallet.id);
  });
});
