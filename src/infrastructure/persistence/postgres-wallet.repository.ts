import { LockMode, UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";
import type { Wallet } from "../../domain/wallet/wallet";
import type { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import type { WalletRepository } from "../../domain/wallet/wallet.repository";
import { DuplicateWalletError, WalletVersionConflictError } from "../../domain/wallet/wallet.errors";
import { toLedgerEntryRow, toWallet, toWalletRow } from "./mappers";
import { WalletLedgerEntryRecord, WalletRecord } from "./records";

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | undefined> {
    const row = await this.em.findOne(WalletRecord, { id });
    return row ? toWallet(row) : undefined;
  }

  async lockById(id: string): Promise<Wallet | undefined> {
    const row = await this.em.findOne(WalletRecord, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return row ? toWallet(row) : undefined;
  }

  async existsForPlayer(playerId: string, currency: string): Promise<boolean> {
    return (await this.em.count(WalletRecord, { playerId, currency })) > 0;
  }

  async insert(wallet: Wallet, openingEntry: WalletLedgerEntry | undefined): Promise<void> {
    try {
      await this.em.insert(WalletRecord, toWalletRow(wallet));
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new DuplicateWalletError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
    if (openingEntry) await this.em.insert(WalletLedgerEntryRecord, toLedgerEntryRow(openingEntry));
  }

  async update(wallet: Wallet, entry: WalletLedgerEntry): Promise<void> {
    const expectedVersion = entry.walletVersion - 1;
    const { balance, version, updatedAt } = toWalletRow(wallet);
    const affected = await this.em.nativeUpdate(
      WalletRecord,
      { id: wallet.id, version: expectedVersion },
      { balance, version, updatedAt },
    );
    if (affected !== 1) throw new WalletVersionConflictError(wallet.id, expectedVersion);
    await this.em.insert(WalletLedgerEntryRecord, toLedgerEntryRow(entry));
  }
}
