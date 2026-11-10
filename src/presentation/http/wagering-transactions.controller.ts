import { Body, Controller, Get, Headers, HttpStatus, Inject, Param, Post, Res } from "@nestjs/common";
import { assertProviderAccess } from "../../application/auth/provider-access";
import type { ProviderIdentity } from "../../application/ports/token-verifier";
import { METRICS, type Metrics } from "../../application/ports/metrics";
import { GetWagerTransactionUseCase } from "../../application/wagering/get-wager-transaction.use-case";
import { SubmitWagerTransactionUseCase } from "../../application/wagering/submit-wager-transaction.use-case";
import type { SubmissionResult, WagerTransactionView } from "../../application/wagering/wager-transaction.view";
import { WagerTransactionStatus } from "../../domain/wagering/wager-transaction-status";
import { WagerTransactionNotFoundError } from "../../application/wagering/wagering.errors";
import { Caller } from "./auth.guard";
import { CORRELATION_ID_HEADER, resolveCorrelationId } from "./correlation-id";
import {
  idempotencyKeySchema,
  providerReferenceSchema,
  submitWagerTransactionSchema,
  uuidSchema,
  type SubmitWagerTransactionBody,
} from "../schemas";
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
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  @Post("wagering/transactions")
  async submit(
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Headers(CORRELATION_ID_HEADER) correlationHeader: string | undefined,
    @Body(new ZodValidationPipe(submitWagerTransactionSchema)) body: SubmitWagerTransactionBody,
    @Res({ passthrough: true }) response: StatusResponse,
    @Caller() caller: ProviderIdentity | undefined,
  ): Promise<SubmissionResult> {
    assertProviderAccess(caller, body.providerId);
    const idempotencyKey = idempotencyKeyPipe.transform(rawIdempotencyKey);
    const startedAt = performance.now();
    const result = await this.submitTransaction.execute({
      ...body,
      idempotencyKey,
      correlationId: resolveCorrelationId(correlationHeader),
    });
    this.metrics.processingDuration("http", (performance.now() - startedAt) / 1_000);
    const httpStatus = HTTP_STATUS_BY_RESULT[result.status];
    if (httpStatus === undefined) throw new Error(`Status de submissão sem mapeamento HTTP: ${result.status}`);
    response.status(httpStatus);
    return result;
  }

  @Get("wagering/transactions/:transactionId")
  async findById(
    @Param("transactionId", new ZodValidationPipe(uuidSchema)) transactionId: string,
    @Caller() caller: ProviderIdentity | undefined,
  ): Promise<WagerTransactionView> {
    const view = await this.getTransaction.byId(transactionId);
    if (caller && view.providerId !== caller.providerId) throw new WagerTransactionNotFoundError(transactionId);
    return view;
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  findByProviderReference(
    @Param(new ZodValidationPipe(providerReferenceSchema))
    params: {
      providerId: string;
      externalTransactionId: string;
    },
    @Caller() caller: ProviderIdentity | undefined,
  ): Promise<WagerTransactionView> {
    assertProviderAccess(caller, params.providerId);
    return this.getTransaction.byProviderReference(params.providerId, params.externalTransactionId);
  }
}
