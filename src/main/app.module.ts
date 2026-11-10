import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HttpErrorFilter } from "../presentation/http/http-error.filter";
import { WageringTransactionsController } from "../presentation/http/wagering-transactions.controller";
import { WalletsController } from "../presentation/http/wallets.controller";
import { UseCasesModule } from "./use-cases.module";

@Module({
  imports: [UseCasesModule],
  controllers: [WalletsController, WageringTransactionsController],
  providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }],
})
export class AppModule {}
