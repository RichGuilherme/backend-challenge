import type { Money } from "../shared/money/money";
import { copyDate } from "../shared/copy-date";
import { LedgerDirection } from "./ledger-direction";
import {
  InvalidLedgerEntryError,
  UnbalancedLedgerEntryError,
} from "./wallet-ledger-entry.errors";

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  walletVersion: number;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type CreateLedgerEntryProps = LedgerEntryState;

export class WalletLedgerEntry {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly walletVersion: number;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  private readonly _createdAt: Date;

  private constructor(state: LedgerEntryState) {
    this.id = state.id;
    this.walletId = state.walletId;
    this.transactionId = state.transactionId;
    this.walletVersion = state.walletVersion;
    this.direction = state.direction;
    this.money = state.money;
    this.balanceBefore = state.balanceBefore;
    this.balanceAfter = state.balanceAfter;
    this._createdAt = copyDate(state.createdAt);
    Object.freeze(this);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError(
        `Valor do lançamento deve ser positivo: ${props.money}`,
      );
    }
    if (!Number.isInteger(props.walletVersion) || props.walletVersion < 1) {
      throw new InvalidLedgerEntryError(
        `Versão da wallet inválida: ${props.walletVersion}`,
      );
    }

    const entry = WalletLedgerEntry.rehydrate(props);

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError(
        props.direction,
        props.money.toString(),
        props.balanceBefore.toString(),
        props.balanceAfter.toString(),
      );
    }
    if (props.balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError(
        `Saldo após o lançamento não pode ser negativo: ${props.balanceAfter}`,
      );
    }
    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state);
  }

  get createdAt(): Date {
    return copyDate(this._createdAt);
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);
    return expected.equals(this.balanceAfter);
  }
}
