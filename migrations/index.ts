import type { MigrationObject } from "@mikro-orm/core";
import { Migration20261109120000FinancialCore } from "./Migration20261109120000FinancialCore";
import { Migration20261109200000DeferLedgerTransactionFk } from "./Migration20261109200000DeferLedgerTransactionFk";
import { Migration20261110000000Outbox } from "./Migration20261110000000Outbox";
import { Migration20261110100000PendingReferences } from "./Migration20261110100000PendingReferences";
import { Migration20261110200000Inbox } from "./Migration20261110200000Inbox";
import { Migration20261110300000NoReferenceOnBetAndLoss } from "./Migration20261110300000NoReferenceOnBetAndLoss";
import { Migration20261110400000IdempotencyKeyPerProvider } from "./Migration20261110400000IdempotencyKeyPerProvider";

export const migrations: MigrationObject[] = [
  { name: "Migration20261109120000FinancialCore", class: Migration20261109120000FinancialCore },
  { name: "Migration20261109200000DeferLedgerTransactionFk", class: Migration20261109200000DeferLedgerTransactionFk },
  { name: "Migration20261110000000Outbox", class: Migration20261110000000Outbox },
  { name: "Migration20261110100000PendingReferences", class: Migration20261110100000PendingReferences },
  { name: "Migration20261110200000Inbox", class: Migration20261110200000Inbox },
  { name: "Migration20261110300000NoReferenceOnBetAndLoss", class: Migration20261110300000NoReferenceOnBetAndLoss },
  { name: "Migration20261110400000IdempotencyKeyPerProvider", class: Migration20261110400000IdempotencyKeyPerProvider },
];
