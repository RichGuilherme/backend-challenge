import type { MigrationObject } from "@mikro-orm/core";
import { Migration20261109120000FinancialCore } from "./Migration20261109120000FinancialCore";
import { Migration20261109200000DeferLedgerTransactionFk } from "./Migration20261109200000DeferLedgerTransactionFk";

export const migrations: MigrationObject[] = [
  { name: "Migration20261109120000FinancialCore", class: Migration20261109120000FinancialCore },
  { name: "Migration20261109200000DeferLedgerTransactionFk", class: Migration20261109200000DeferLedgerTransactionFk },
];
