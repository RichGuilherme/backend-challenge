import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from "@nestjs/common";
import { GetWalletUseCase } from "../../application/wallet/get-wallet.use-case";
import { OpenWalletUseCase } from "../../application/wallet/open-wallet.use-case";
import type { WalletView } from "../../application/wallet/wallet.view";
import { createWalletSchema, uuidSchema, type CreateWalletBody } from "./schemas";
import { ZodValidationPipe } from "./zod-validation.pipe";

@Controller("wallets")
export class WalletsController {
  constructor(
    @Inject(OpenWalletUseCase) private readonly openWallet: OpenWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(createWalletSchema)) body: CreateWalletBody): Promise<WalletView> {
    return this.openWallet.execute(body);
  }

  @Get(":walletId")
  findOne(@Param("walletId", new ZodValidationPipe(uuidSchema)) walletId: string): Promise<WalletView> {
    return this.getWallet.execute(walletId);
  }
}
