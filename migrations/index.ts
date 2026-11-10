import type { MigrationObject } from "@mikro-orm/core";
import { Migration20261109120000FinancialCore } from "./Migration20261109120000FinancialCore";
import { Migration20261109200000DeferLedgerTransactionFk } from "./Migration20261109200000DeferLedgerTransactionFk";
import { Migration20261110000000Outbox } from "./Migration20261110000000Outbox";

export const migrations: MigrationObject[] = [
  { name: "Migration20261109120000FinancialCore", class: Migration20261109120000FinancialCore },
  { name: "Migration20261109200000DeferLedgerTransactionFk", class: Migration20261109200000DeferLedgerTransactionFk },
  { name: "Migration20261110000000Outbox", class: Migration20261110000000Outbox },
];
