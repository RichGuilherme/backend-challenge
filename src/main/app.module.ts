import { Module } from "@nestjs/common";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { GetWagerTransactionUseCase } from "../application/wagering/get-wager-transaction.use-case";
import { SubmitWagerTransactionUseCase } from "../application/wagering/submit-wager-transaction.use-case";
import { GetWalletUseCase } from "../application/wallet/get-wallet.use-case";
import { OpenWalletUseCase } from "../application/wallet/open-wallet.use-case";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/system/uuid-v7-id-generator";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, ID_GENERATOR, UNIT_OF_WORK } from "./tokens";

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidV7IdGenerator },
    {
      provide: OpenWalletUseCase,
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK],
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new OpenWalletUseCase(unitOfWork, ids, clock),
    },
    {
      provide: GetWalletUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new GetWalletUseCase(unitOfWork),
    },
    {
      provide: SubmitWagerTransactionUseCase,
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK],
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock) =>
        new SubmitWagerTransactionUseCase(unitOfWork, ids, clock),
    },
    {
      provide: GetWagerTransactionUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new GetWagerTransactionUseCase(unitOfWork),
    },
  ],
})
export class AppModule {}
