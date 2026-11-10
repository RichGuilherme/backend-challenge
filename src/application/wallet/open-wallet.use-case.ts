import { Money, type MoneyProps } from "../../domain/shared/money/money";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import { Wallet } from "../../domain/wallet/wallet";
import { DuplicateWalletError } from "../../domain/wallet/wallet.errors";
import { eventContextFactory, type EventTrace } from "../messaging/event-trace";
import { WalletBalanceChanged } from "../messaging/integration-events";
import { OutboxMessage } from "../messaging/outbox-message";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { TransactionScope, UnitOfWork } from "../ports/unit-of-work";
import { WalletAlreadyExistsError } from "./wallet.errors";
import { toWalletView, type WalletView } from "./wallet.view";

export interface OpenWalletCommand extends EventTrace {
  playerId: string;
  initialBalance: MoneyProps;
}

export class OpenWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: OpenWalletCommand): Promise<WalletView> {
    const initialBalance = Money.from(command.initialBalance);
    try {
      return await this.unitOfWork.run((scope) => this.open(scope, command, initialBalance));
    } catch (error) {
      if (error instanceof DuplicateWalletError) {
        throw new WalletAlreadyExistsError(command.playerId, initialBalance.currency);
      }
      throw error;
    }
  }

  private async open(scope: TransactionScope, command: OpenWalletCommand, initialBalance: Money): Promise<WalletView> {
    const { playerId } = command;
    if (await scope.wallets.existsForPlayer(playerId, initialBalance.currency)) {
      throw new WalletAlreadyExistsError(playerId, initialBalance.currency);
    }

    const at = this.clock.now();
    const walletId = this.ids.next();
    const openingTransactionId = this.ids.next();
    const { wallet, openingEntry } = Wallet.open({
      id: walletId,
      playerId,
      initialBalance,
      at,
      opening: { transactionId: openingTransactionId, entryId: this.ids.next() },
    });

    await scope.wallets.insert(wallet, openingEntry);
    if (openingEntry) {
      await scope.transactions.insert(
        WagerTransaction.opening({ id: openingTransactionId, walletId, playerId, money: initialBalance, at }),
      );
      const balanceChanged = WalletBalanceChanged.from(
        wallet,
        openingEntry,
        eventContextFactory(command, this.ids, at)(),
      );
      await scope.outbox.add([OutboxMessage.enqueue(balanceChanged)]);
    }
    return toWalletView(wallet);
  }
}
