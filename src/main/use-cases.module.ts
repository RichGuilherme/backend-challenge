import { Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { UnitOfWork } from "../application/ports/unit-of-work";
import { GetWagerTransactionUseCase } from "../application/wagering/get-wager-transaction.use-case";
import { SubmitWagerTransactionUseCase } from "../application/wagering/submit-wager-transaction.use-case";
import { GetWalletUseCase } from "../application/wallet/get-wallet.use-case";
import { GetWalletLedgerUseCase } from "../application/wallet/get-wallet-ledger.use-case";
import { OpenWalletUseCase } from "../application/wallet/open-wallet.use-case";
import { ReconcileWalletUseCase } from "../application/wallet/reconcile-wallet.use-case";
import { PrometheusDivergenceAlert } from "../infrastructure/observability/prometheus-divergence-alert";
import { SqlLedgerQuery } from "../infrastructure/persistence/sql-ledger.query";
import { SqlReconciliationQuery } from "../infrastructure/persistence/sql-reconciliation.query";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidV7IdGenerator } from "../infrastructure/system/uuid-v7-id-generator";
import { loadPendingReferenceConfig } from "../shared/config/env";
import { ObservabilityModule } from "./observability.module";
import { PersistenceModule } from "./persistence.module";
import { CLOCK, ID_GENERATOR, METRICS_REGISTRY, UNIT_OF_WORK } from "./tokens";

@Module({
  imports: [PersistenceModule, ObservabilityModule],
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
        new SubmitWagerTransactionUseCase(unitOfWork, ids, clock, loadPendingReferenceConfig().policy),
    },
    {
      provide: GetWagerTransactionUseCase,
      inject: [UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) => new GetWagerTransactionUseCase(unitOfWork),
    },
    {
      provide: GetWalletLedgerUseCase,
      inject: [MikroORM],
      useFactory: (orm: MikroORM) => new GetWalletLedgerUseCase(new SqlLedgerQuery(orm.em)),
    },
    {
      provide: ReconcileWalletUseCase,
      inject: [MikroORM, METRICS_REGISTRY],
      useFactory: (orm: MikroORM, registry: Registry) =>
        new ReconcileWalletUseCase(new SqlReconciliationQuery(orm.em), new PrometheusDivergenceAlert(registry)),
    },
  ],
  exports: [
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    PersistenceModule,
    CLOCK,
    ID_GENERATOR,
    OpenWalletUseCase,
    GetWalletUseCase,
    SubmitWagerTransactionUseCase,
    GetWagerTransactionUseCase,
  ],
})
export class UseCasesModule {}
