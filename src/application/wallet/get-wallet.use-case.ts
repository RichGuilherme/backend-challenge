import type { UnitOfWork } from "../ports/unit-of-work";
import { WalletNotFoundError } from "./wallet.errors";
import { toWalletView, type WalletView } from "./wallet.view";

export class GetWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(walletId: string): Promise<WalletView> {
    return this.unitOfWork.run(async ({ wallets }) => {
      const wallet = await wallets.findById(walletId);
      if (!wallet) throw new WalletNotFoundError(walletId);
      return toWalletView(wallet);
    });
  }
}
