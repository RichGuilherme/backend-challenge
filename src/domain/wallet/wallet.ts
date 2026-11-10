import { Money } from "../shared/money/money";
import { copyDate } from "../shared/copy-date";
import { LedgerDirection } from "./ledger-direction";
import { WalletLedgerEntry } from "./wallet-ledger-entry";
import {
  InsufficientFundsError,
  InvalidMovementAmountError,
  InvalidOpeningBalanceError,
  WalletCurrencyMismatchError,
} from "./wallet.errors";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  at: Date;
  opening: { transactionId: string; entryId: string };
}

export interface OpenedWallet {
  wallet: Wallet;
  openingEntry: WalletLedgerEntry | undefined;
}

export interface WalletMovement {
  entryId: string;
  transactionId: string;
  money: Money;
  at: Date;
}

const INITIAL_VERSION = 1;

export class Wallet {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  private _balance: Money;
  private _version: number;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this._createdAt = copyDate(state.createdAt);
    this._balance = state.balance;
    this._version = state.version;
    this._updatedAt = copyDate(state.updatedAt);
  }

  static open(props: OpenWalletProps): OpenedWallet {
    const { id, playerId, initialBalance, at, opening } = props;
    if (initialBalance.isNegative()) throw new InvalidOpeningBalanceError(initialBalance);

    const wallet = new Wallet({
      id,
      playerId,
      currency: initialBalance.currency,
      balance: initialBalance,
      version: INITIAL_VERSION,
      createdAt: at,
      updatedAt: at,
    });
    if (initialBalance.isZero()) return { wallet, openingEntry: undefined };

    const openingEntry = WalletLedgerEntry.create({
      id: opening.entryId,
      walletId: id,
      transactionId: opening.transactionId,
      walletVersion: INITIAL_VERSION,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt: at,
    });
    return { wallet, openingEntry };
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return copyDate(this._createdAt);
  }

  get updatedAt(): Date {
    return copyDate(this._updatedAt);
  }

  debit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidMovement(movement.money);
    if (this._balance.isLessThan(movement.money)) {
      throw new InsufficientFundsError(this.id, this._balance, movement.money);
    }
    return this.apply(LedgerDirection.Debit, movement, this._balance.subtract(movement.money));
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    this.assertValidMovement(movement.money);
    return this.apply(LedgerDirection.Credit, movement, this._balance.add(movement.money));
  }

  private apply(direction: LedgerDirection, movement: WalletMovement, balanceAfter: Money): WalletLedgerEntry {
    const entry = WalletLedgerEntry.create({
      id: movement.entryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      walletVersion: this._version + 1,
      direction,
      money: movement.money,
      balanceBefore: this._balance,
      balanceAfter,
      createdAt: movement.at,
    });
    this._balance = entry.balanceAfter;
    this._version = entry.walletVersion;
    this._updatedAt = copyDate(movement.at);

    return entry;
  }

  private assertValidMovement(money: Money): void {
    if (money.currency !== this.currency) {
      throw new WalletCurrencyMismatchError(this.id, this.currency, money.currency);
    }
    if (!money.isPositive()) throw new InvalidMovementAmountError(money);
  }
}
