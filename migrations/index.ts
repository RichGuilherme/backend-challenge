import type { MigrationObject } from "@mikro-orm/core";
import { Migration20261109120000FinancialCore } from "./Migration20261109120000FinancialCore";

export const migrations: MigrationObject[] = [
  { name: "Migration20261109120000FinancialCore", class: Migration20261109120000FinancialCore },
];
