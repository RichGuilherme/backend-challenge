import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, Post, Query } from "@nestjs/common";
import type { LedgerEntryView } from "../../application/ports/ledger.query";
import { GetWalletLedgerUseCase } from "../../application/wallet/get-wallet-ledger.use-case";
import { GetWalletUseCase } from "../../application/wallet/get-wallet.use-case";
import { OpenWalletUseCase } from "../../application/wallet/open-wallet.use-case";
import { ReconcileWalletUseCase, type ReconciliationReport } from "../../application/wallet/reconcile-wallet.use-case";
import type { WalletView } from "../../application/wallet/wallet.view";
import { createWalletSchema, ledgerQuerySchema, uuidSchema, type CreateWalletBody, type LedgerQueryParams } from "../schemas";
import { CORRELATION_ID_HEADER, resolveCorrelationId } from "./correlation-id";
import { decodeLedgerCursor, encodeLedgerCursor } from "./ledger-cursor";
import { ZodValidationPipe } from "./zod-validation.pipe";

const DEFAULT_LEDGER_PAGE_SIZE = 50;

interface LedgerPageResponse {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

@Controller("wallets")
export class WalletsController {
  constructor(
    @Inject(OpenWalletUseCase) private readonly openWallet: OpenWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
    @Inject(GetWalletLedgerUseCase) private readonly getLedger: GetWalletLedgerUseCase,
    @Inject(ReconcileWalletUseCase) private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createWalletSchema)) body: CreateWalletBody,
    @Headers(CORRELATION_ID_HEADER) correlationHeader: string | undefined,
  ): Promise<WalletView> {
    return this.openWallet.execute({ ...body, correlationId: resolveCorrelationId(correlationHeader) });
  }

  @Get(":walletId")
  findOne(@Param("walletId", new ZodValidationPipe(uuidSchema)) walletId: string): Promise<WalletView> {
    return this.getWallet.execute(walletId);
  }

  @Get(":walletId/ledger")
  async ledger(
    @Param("walletId", new ZodValidationPipe(uuidSchema)) walletId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQueryParams,
  ): Promise<LedgerPageResponse> {
    const page = await this.getLedger.execute({
      walletId,
      afterVersion: decodeLedgerCursor(query.cursor),
      limit: query.limit ?? DEFAULT_LEDGER_PAGE_SIZE,
    });
    return {
      entries: page.entries,
      nextCursor: page.nextAfterVersion === null ? null : encodeLedgerCursor(page.nextAfterVersion),
    };
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  reconcile(@Param("walletId", new ZodValidationPipe(uuidSchema)) walletId: string): Promise<ReconciliationReport> {
    return this.reconcileWallet.execute(walletId);
  }
}
