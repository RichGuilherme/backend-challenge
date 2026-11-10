import { Body, Controller, Get, Headers, HttpStatus, Inject, Param, Post, Res } from "@nestjs/common";
import { GetWagerTransactionUseCase } from "../../application/wagering/get-wager-transaction.use-case";
import { SubmitWagerTransactionUseCase } from "../../application/wagering/submit-wager-transaction.use-case";
import type { SubmissionResult, WagerTransactionView } from "../../application/wagering/wager-transaction.view";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { CORRELATION_ID_HEADER, resolveCorrelationId } from "./correlation-id";
import {
  idempotencyKeySchema,
  providerReferenceSchema,
  submitWagerTransactionSchema,
  uuidSchema,
  type SubmitWagerTransactionBody,
} from "./schemas";
import { ZodValidationPipe } from "./zod-validation.pipe";

interface StatusResponse {
  status(code: number): unknown;
}

const idempotencyKeyPipe = new ZodValidationPipe(idempotencyKeySchema);

const HTTP_STATUS_BY_RESULT: Readonly<Partial<Record<WagerTransactionStatus, number>>> = {
  [WagerTransactionStatus.Processed]: HttpStatus.OK,
  [WagerTransactionStatus.PendingReference]: HttpStatus.ACCEPTED,
  [WagerTransactionStatus.Rejected]: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Controller()
export class WageringTransactionsController {
  constructor(
    @Inject(SubmitWagerTransactionUseCase) private readonly submitTransaction: SubmitWagerTransactionUseCase,
    @Inject(GetWagerTransactionUseCase) private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post("wagering/transactions")
  async submit(
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Headers(CORRELATION_ID_HEADER) correlationHeader: string | undefined,
    @Body(new ZodValidationPipe(submitWagerTransactionSchema)) body: SubmitWagerTransactionBody,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<SubmissionResult> {
    const idempotencyKey = idempotencyKeyPipe.transform(rawIdempotencyKey);
    const result = await this.submitTransaction.execute({
      ...body,
      idempotencyKey,
      correlationId: resolveCorrelationId(correlationHeader),
    });
    const httpStatus = HTTP_STATUS_BY_RESULT[result.status];
    if (httpStatus === undefined) throw new Error(`Status de submissão sem mapeamento HTTP: ${result.status}`);
    response.status(httpStatus);
    return result;
  }

  @Get("wagering/transactions/:transactionId")
  findById(
    @Param("transactionId", new ZodValidationPipe(uuidSchema)) transactionId: string,
  ): Promise<WagerTransactionView> {
    return this.getTransaction.byId(transactionId);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  findByProviderReference(
    @Param(new ZodValidationPipe(providerReferenceSchema)) params: { providerId: string; externalTransactionId: string },
  ): Promise<WagerTransactionView> {
    return this.getTransaction.byProviderReference(params.providerId, params.externalTransactionId);
  }
}
