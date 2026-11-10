import type { LedgerEntryView, LedgerQuery } from "../ports/ledger.query";
import { WalletNotFoundError } from "./wallet.errors";

export interface LedgerPageRequest {
  walletId: string;
  afterVersion: number;
  limit: number;
}

export interface LedgerPage {
  entries: LedgerEntryView[];
  nextAfterVersion: number | null;
}

export class GetWalletLedgerUseCase {
  constructor(private readonly ledger: LedgerQuery) {}

  async execute(request: LedgerPageRequest): Promise<LedgerPage> {
    if (!(await this.ledger.walletExists(request.walletId))) throw new WalletNotFoundError(request.walletId);
    const fetched = await this.ledger.entriesAfter(request.walletId, request.afterVersion, request.limit + 1);
    const entries = fetched.slice(0, request.limit);
    const hasMore = fetched.length > request.limit;
    return { entries, nextAfterVersion: hasMore ? (entries.at(-1)?.walletVersion ?? null) : null };
  }
}
