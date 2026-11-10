import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import type { MikroORM } from "@mikro-orm/postgresql";
import { connectTestDatabase, initTestOrm, recreateTestDatabase } from "../../support/database";

type Row = Record<string, string | number | Date | null>;

let orm: MikroORM;
let sql: SQL;

beforeAll(async () => {
  await recreateTestDatabase();
  orm = await initTestOrm();
  sql = connectTestDatabase();
});

afterAll(async () => {
  await sql?.close();
  await orm?.close(true);
});

const now = new Date("2026-11-09T12:00:00.000Z");

function walletRow(overrides: Row = {}) {
  return {
    id: crypto.randomUUID(),
    player_id: `player-${crypto.randomUUID()}`,
    currency: "BRL",
    balance: "0.00",
    version: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function transactionRow(walletId: string, overrides: Row = {}) {
  const external = `ext-${crypto.randomUUID()}`;
  return {
    id: crypto.randomUUID(),
    provider_id: "provider-a",
    external_transaction_id: external,
    idempotency_key: `provider-a:${external}`,
    payload_hash: "hash",
    wallet_id: walletId,
    player_id: "player-1",
    round_id: "round-1",
    game_id: "game-1",
    kind: "BET",
    amount: "25.00",
    currency: "BRL",
    reference_external_transaction_id: null,
    reference_transaction_id: null,
    status: "PENDING",
    failure_code: null,
    observed_balance: null,
    processed_at: null,
    created_at: now,
    ...overrides,
  };
}

const processed = (observedBalance: string): Row => ({
  status: "PROCESSED",
  observed_balance: observedBalance,
  processed_at: now,
});

function ledgerRow(walletId: string, transactionId: string, overrides: Row = {}) {
  return {
    id: crypto.randomUUID(),
    wallet_id: walletId,
    transaction_id: transactionId,
    wallet_version: 1,
    direction: "CREDIT",
    amount: "100.00",
    balance_before: "0.00",
    balance_after: "100.00",
    created_at: now,
    ...overrides,
  };
}

const insert = (db: SQL, table: string, row: Row) => db`insert into ${db(table)} ${db(row)}`;

async function seedWallet(balance = "100.00"): Promise<{ walletId: string; openingId: string | undefined }> {
  const wallet = walletRow({ balance });
  let openingId: string | undefined;
  await sql.begin(async (tx) => {
    await insert(tx, "wallets", wallet);
    if (balance === "0.00") return;
    const opening = transactionRow(String(wallet.id), {
      provider_id: "internal",
      external_transaction_id: String(wallet.id),
      idempotency_key: `opening:${wallet.id}`,
      kind: "OPENING",
      amount: balance,
      ...processed(balance),
    });
    openingId = String(opening.id);
    await insert(tx, "wager_transactions", opening);
    await insert(
      tx,
      "wallet_ledger_entries",
      ledgerRow(String(wallet.id), openingId, { amount: balance, balance_after: balance }),
    );
  });
  return { walletId: String(wallet.id), openingId };
}

async function seedProcessedBet(walletId: string): Promise<string> {
  const bet = transactionRow(walletId, processed("75.00"));
  await insert(sql, "wager_transactions", bet);
  return String(bet.id);
}

async function expectConstraint(operation: Promise<unknown>, constraint: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ constraint });
}

async function expectTriggerRejection(operation: Promise<unknown>, message: string): Promise<void> {
  const error = await operation.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toMatchObject({ errno: "P0001" });
  expect(String((error as Error).message)).toContain(message);
}

async function tableExists(name: string): Promise<boolean> {
  const [row] = await sql`select to_regclass(${name}) is not null as exists`;
  return row.exists === true;
}

describe("schema financeiro", () => {
  describe("migrations", () => {
    test("sobem, descem e sobem pelo migrator", async () => {
      await orm.migrator.up();
      expect(await tableExists("wallet_ledger_entries")).toBe(true);

      await orm.migrator.down({ to: 0 });
      for (const table of ["wallets", "wager_transactions", "wallet_ledger_entries"]) {
        expect(await tableExists(table)).toBe(false);
      }

      await orm.migrator.up();
      expect(await orm.migrator.getPending()).toHaveLength(0);
      for (const table of ["wallets", "wager_transactions", "wallet_ledger_entries"]) {
        expect(await tableExists(table)).toBe(true);
      }
    });
  });

  describe("wallets", () => {
    test("wallet com saldo inicial, OPENING e lançamento na mesma transação é aceita", async () => {
      const { walletId, openingId } = await seedWallet("100.00");
      const [wallet] = await sql`select balance, version from wallets where id = ${walletId}`;
      expect(wallet).toEqual({ balance: "100.00", version: 1 });
      expect(openingId).toBeDefined();
    });

    test("wallet com saldo zero não precisa de lançamento", async () => {
      await seedWallet("0.00");
    });

    test("uma wallet por player e moeda", async () => {
      const wallet = walletRow();
      await insert(sql, "wallets", wallet);
      await expectConstraint(
        insert(sql, "wallets", walletRow({ player_id: wallet.player_id })),
        "wallets_player_currency_unique",
      );
    });

    test("mesmo player em outra moeda é permitido", async () => {
      const wallet = walletRow();
      await insert(sql, "wallets", wallet);
      await insert(sql, "wallets", walletRow({ player_id: wallet.player_id, currency: "USD" }));
    });

    test("saldo negativo", async () => {
      await expectConstraint(insert(sql, "wallets", walletRow({ balance: "-0.01" })), "wallets_balance_non_negative");
    });

    test("moeda fora do formato ISO", async () => {
      await expectConstraint(insert(sql, "wallets", walletRow({ currency: "brl" })), "wallets_currency_format");
    });

    test("versão menor que 1", async () => {
      await expectConstraint(insert(sql, "wallets", walletRow({ version: 0 })), "wallets_version_positive");
    });

    test("wallet criada com saldo sem lançamento falha no commit", async () => {
      await expectTriggerRejection(
        insert(sql, "wallets", walletRow({ balance: "50.00" })),
        "não tem lançamento correspondente",
      );
    });

    test("saldo alterado sem lançamento falha no commit", async () => {
      const { walletId } = await seedWallet("100.00");
      await expectTriggerRejection(
        sql`update wallets set balance = 75.00, version = 2 where id = ${walletId}`,
        "não tem lançamento correspondente",
      );
      const [wallet] = await sql`select balance, version from wallets where id = ${walletId}`;
      expect(wallet).toEqual({ balance: "100.00", version: 1 });
    });

    test("saldo alterado com o lançamento da nova versão é aceito", async () => {
      const { walletId } = await seedWallet("100.00");
      await sql.begin(async (tx) => {
        const bet = transactionRow(walletId, processed("75.00"));
        await insert(tx, "wager_transactions", bet);
        await insert(
          tx,
          "wallet_ledger_entries",
          ledgerRow(walletId, String(bet.id), {
            wallet_version: 2,
            direction: "DEBIT",
            amount: "25.00",
            balance_before: "100.00",
            balance_after: "75.00",
          }),
        );
        await tx`update wallets set balance = 75.00, version = 2 where id = ${walletId}`;
      });
      const [wallet] = await sql`select balance, version from wallets where id = ${walletId}`;
      expect(wallet).toEqual({ balance: "75.00", version: 2 });
    });
  });

  describe("wager_transactions", () => {
    test("provider + externalTransactionId únicos", async () => {
      const { walletId } = await seedWallet();
      const tx = transactionRow(walletId);
      await insert(sql, "wager_transactions", tx);
      await expectConstraint(
        insert(
          sql,
          "wager_transactions",
          transactionRow(walletId, { external_transaction_id: tx.external_transaction_id }),
        ),
        "wager_transactions_provider_external_unique",
      );
    });

    test("idempotency key única", async () => {
      const { walletId } = await seedWallet();
      const tx = transactionRow(walletId);
      await insert(sql, "wager_transactions", tx);
      await expectConstraint(
        insert(sql, "wager_transactions", transactionRow(walletId, { idempotency_key: tx.idempotency_key })),
        "wager_transactions_idempotency_key_unique",
      );
    });

    test.each<[string, Row, string]>([
      ["kind inválido", { kind: "JACKPOT" }, "wager_transactions_kind_valid"],
      ["status inválido", { status: "DONE" }, "wager_transactions_status_valid"],
      [
        "failureCode inválido",
        { status: "REJECTED", failure_code: "NOPE", observed_balance: "1.00", processed_at: now },
        "wager_transactions_failure_code_valid",
      ],
      ["valor zero", { amount: "0.00" }, "wager_transactions_amount_positive"],
      ["valor negativo", { amount: "-1.00" }, "wager_transactions_amount_positive"],
      ["moeda fora do formato", { currency: "R$X" }, "wager_transactions_currency_format"],
      [
        "saldo observado negativo",
        { status: "PROCESSED", observed_balance: "-1.00", processed_at: now },
        "wager_transactions_observed_balance_non_negative",
      ],
      ["OPENING de provider externo", { kind: "OPENING" }, "wager_transactions_opening_internal_provider"],
      ["BET do provider interno", { provider_id: "internal" }, "wager_transactions_opening_internal_provider"],
      [
        "BET com referência",
        { kind: "BET", reference_external_transaction_id: "ext-x" },
        "wager_transactions_bet_loss_have_no_reference",
      ],
      [
        "LOSS com referência",
        { kind: "LOSS", reference_external_transaction_id: "ext-x" },
        "wager_transactions_bet_loss_have_no_reference",
      ],
      ["REFUND sem referência", { kind: "REFUND" }, "wager_transactions_reversal_requires_reference"],
      ["ROLLBACK sem referência", { kind: "ROLLBACK" }, "wager_transactions_reversal_requires_reference"],
      [
        "reversão PROCESSED sem id interno da referência",
        { kind: "REFUND", reference_external_transaction_id: "ext-x", ...processed("1.00") },
        "wager_transactions_processed_reversal_has_reference",
      ],
      [
        "REJECTED sem failureCode",
        { status: "REJECTED", observed_balance: "1.00", processed_at: now },
        "wager_transactions_failure_code_matches_status",
      ],
      [
        "PROCESSED com failureCode",
        { ...processed("1.00"), failure_code: "INSUFFICIENT_FUNDS" },
        "wager_transactions_failure_code_matches_status",
      ],
      [
        "PROCESSED sem saldo observado",
        { status: "PROCESSED", processed_at: now },
        "wager_transactions_observed_balance_matches_status",
      ],
      [
        "PENDING com saldo observado",
        { observed_balance: "1.00" },
        "wager_transactions_observed_balance_matches_status",
      ],
      ["PENDING com processed_at", { processed_at: now }, "wager_transactions_processed_at_matches_status"],
      [
        "FAILED sem processed_at",
        { status: "FAILED", failure_code: "INSUFFICIENT_FUNDS" },
        "wager_transactions_processed_at_matches_status",
      ],
    ])("%s", async (_label, overrides, constraint) => {
      const { walletId } = await seedWallet();
      await expectConstraint(insert(sql, "wager_transactions", transactionRow(walletId, overrides)), constraint);
    });

    test("wallet inexistente", async () => {
      await expectConstraint(
        insert(sql, "wager_transactions", transactionRow(crypto.randomUUID())),
        "wager_transactions_wallet_fk",
      );
    });

    describe("no máximo uma reversão processada por referência, de qualquer tipo", () => {
      const reversalOf = (walletId: string, referenceId: string, kind: string): Row =>
        transactionRow(walletId, {
          kind,
          reference_external_transaction_id: "ext-ref",
          reference_transaction_id: referenceId,
          ...processed("100.00"),
        });

      test("REFUND e depois ROLLBACK da mesma BET", async () => {
        const { walletId } = await seedWallet();
        const betId = await seedProcessedBet(walletId);
        await insert(sql, "wager_transactions", reversalOf(walletId, betId, "REFUND"));
        await expectConstraint(
          insert(sql, "wager_transactions", reversalOf(walletId, betId, "ROLLBACK")),
          "wager_transactions_single_reversal_per_reference",
        );
      });

      test("reversão REJECTED da mesma referência não conta", async () => {
        const { walletId } = await seedWallet();
        const betId = await seedProcessedBet(walletId);
        await insert(sql, "wager_transactions", reversalOf(walletId, betId, "REFUND"));
        await insert(
          sql,
          "wager_transactions",
          transactionRow(walletId, {
            kind: "ROLLBACK",
            reference_external_transaction_id: "ext-ref",
            reference_transaction_id: betId,
            status: "REJECTED",
            failure_code: "REFERENCE_ALREADY_REVERSED",
            observed_balance: "100.00",
            processed_at: now,
          }),
        );
      });

      test("ROLLBACK de um REFUND aponta para outra transação e é permitido", async () => {
        const { walletId } = await seedWallet();
        const betId = await seedProcessedBet(walletId);
        const refund = reversalOf(walletId, betId, "REFUND");
        await insert(sql, "wager_transactions", refund);
        await insert(sql, "wager_transactions", reversalOf(walletId, String(refund.id), "ROLLBACK"));
      });
    });

    describe("imutabilidade", () => {
      test("transação não terminal pode avançar de estado", async () => {
        const { walletId } = await seedWallet();
        const tx = transactionRow(walletId);
        await insert(sql, "wager_transactions", tx);
        await sql`update wager_transactions set status = 'PROCESSED', observed_balance = 75.00, processed_at = ${now} where id = ${tx.id}`;
      });

      test.each([
        ["PROCESSED", processed("75.00")],
        [
          "REJECTED",
          { status: "REJECTED", failure_code: "INSUFFICIENT_FUNDS", observed_balance: "1.00", processed_at: now },
        ],
        ["FAILED", { status: "FAILED", failure_code: "INSUFFICIENT_FUNDS", processed_at: now }],
      ])("transação %s não pode ser alterada", async (_status, outcome) => {
        const { walletId } = await seedWallet();
        const tx = transactionRow(walletId, outcome as Row);
        await insert(sql, "wager_transactions", tx);
        await expectTriggerRejection(
          sql`update wager_transactions set status = 'PENDING', failure_code = null, observed_balance = null, processed_at = null where id = ${tx.id}`,
          "estado terminal",
        );
      });

      test("transação não pode ser excluída", async () => {
        const { walletId } = await seedWallet();
        const tx = transactionRow(walletId);
        await insert(sql, "wager_transactions", tx);
        await expectTriggerRejection(sql`delete from wager_transactions where id = ${tx.id}`, "não aceita DELETE");
      });

      test("tabela não pode ser truncada", async () => {
        await expectTriggerRejection(sql`truncate wager_transactions cascade`, "não aceita TRUNCATE");
      });
    });
  });

  describe("wallet_ledger_entries", () => {
    async function seedEntryContext() {
      const { walletId } = await seedWallet("0.00");
      const tx = transactionRow(walletId, processed("100.00"));
      await insert(sql, "wager_transactions", tx);
      return { walletId, transactionId: String(tx.id) };
    }

    test.each<[string, Row, string]>([
      ["aritmética que não fecha", { balance_after: "100.01" }, "wallet_ledger_entries_balanced"],
      ["direção trocada", { direction: "DEBIT" }, "wallet_ledger_entries_balanced"],
      ["direção inválida", { direction: "SIDEWAYS" }, "wallet_ledger_entries_direction_valid"],
      ["valor zero", { amount: "0.00", balance_after: "0.00" }, "wallet_ledger_entries_amount_positive"],
      [
        "saldo final negativo",
        { direction: "DEBIT", amount: "10.00", balance_before: "0.00", balance_after: "-10.00" },
        "wallet_ledger_entries_balances_non_negative",
      ],
      ["versão menor que 1", { wallet_version: 0 }, "wallet_ledger_entries_version_positive"],
    ])("%s", async (_label, overrides, constraint) => {
      const { walletId, transactionId } = await seedEntryContext();
      await expectConstraint(
        insert(sql, "wallet_ledger_entries", ledgerRow(walletId, transactionId, overrides)),
        constraint,
      );
    });

    test("um lançamento por transação por wallet", async () => {
      const { walletId, openingId } = await seedWallet("100.00");
      await expectConstraint(
        insert(
          sql,
          "wallet_ledger_entries",
          ledgerRow(walletId, String(openingId), {
            wallet_version: 2,
            balance_before: "100.00",
            balance_after: "200.00",
          }),
        ),
        "wallet_ledger_entries_transaction_unique",
      );
    });

    test("versão da wallet não se repete no ledger", async () => {
      const { walletId } = await seedWallet("100.00");
      const betId = await seedProcessedBet(walletId);
      await expectConstraint(
        insert(sql, "wallet_ledger_entries", ledgerRow(walletId, betId, { wallet_version: 1 })),
        "wallet_ledger_entries_version_unique",
      );
    });

    test("lançamento não pode ser alterado", async () => {
      const { walletId } = await seedWallet("100.00");
      await expectTriggerRejection(
        sql`update wallet_ledger_entries set created_at = now() where wallet_id = ${walletId}`,
        "imutável",
      );
    });

    test("lançamento não pode ser excluído", async () => {
      const { walletId } = await seedWallet("100.00");
      await expectTriggerRejection(sql`delete from wallet_ledger_entries where wallet_id = ${walletId}`, "imutável");
    });

    test("ledger não pode ser truncado", async () => {
      await expectTriggerRejection(sql`truncate wallet_ledger_entries`, "imutável");
    });
  });
});
