import { expect } from "bun:test";
import type { SQL } from "bun";

export async function expectWalletMatchesLedger(sql: SQL, walletId: string): Promise<void> {
  const [row] = await sql`
    select
      w.balance,
      w.version,
      coalesce(sum(case e.direction when 'CREDIT' then e.amount else -e.amount end), 0)::numeric(20, 2) as rebuilt,
      coalesce(max(e.wallet_version), 1) as last_version
    from wallets w
    left join wallet_ledger_entries e on e.wallet_id = w.id
    where w.id = ${walletId}
    group by w.id
  `;
  expect(row).toBeDefined();
  expect(row.rebuilt).toBe(row.balance);
  expect(row.last_version).toBe(row.version);
}

export async function expectAllWalletsMatchLedger(sql: SQL): Promise<void> {
  const wallets: { id: string }[] = await sql`select id from wallets`;
  for (const { id } of wallets) await expectWalletMatchesLedger(sql, id);
}
