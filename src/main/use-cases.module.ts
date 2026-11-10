import { Module } from "@nestjs/common";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Registry } from "prom-client";
import type { Clock } from "../application/ports/clock";
import type { IdGenerator } from "../application/ports/id-generator";
import type { Logger } from "../application/ports/logger";
import type { Observability } from "../application/ports/observability";
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
import { loadPendingReferenceConfig } from "../shared/config/env";
import { InfrastructureModule } from "./infrastructure.module";
import { CLOCK, ID_GENERATOR, LOGGER, OBSERVABILITY, METRICS_REGISTRY, UNIT_OF_WORK } from "./tokens";

@Module({
  imports: [InfrastructureModule],
  providers: [
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
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK, OBSERVABILITY],
      useFactory: (unitOfWork: UnitOfWork, ids: IdGenerator, clock: Clock, observability: Observability) =>
        new SubmitWagerTransactionUseCase(
          unitOfWork,
          ids,
          clock,
          loadPendingReferenceConfig().policy,
          Math.random,
          observability,
        ),
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
      inject: [MikroORM, METRICS_REGISTRY, LOGGER],
      useFactory: (orm: MikroORM, registry: Registry, logger: Logger) =>
        new ReconcileWalletUseCase(new SqlReconciliationQuery(orm.em), new PrometheusDivergenceAlert(registry, logger)),
    },
  ],
  exports: [
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    OpenWalletUseCase,
    GetWalletUseCase,
    SubmitWagerTransactionUseCase,
    GetWagerTransactionUseCase,
  ],
})
export class UseCasesModule {}
