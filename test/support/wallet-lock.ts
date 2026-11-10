import type { UnitOfWork } from "../../src/application/ports/unit-of-work";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

export async function holdWalletLock(unitOfWork: UnitOfWork, walletId: string): Promise<{ release(): Promise<void> }> {
  const locked = deferred();
  const hold = deferred();
  const holder = unitOfWork.run(async ({ wallets }) => {
    await wallets.lockById(walletId);
    locked.resolve();
    await hold.promise;
  });
  await locked.promise;
  return {
    async release() {
      hold.resolve();
      await holder;
    },
  };
}
