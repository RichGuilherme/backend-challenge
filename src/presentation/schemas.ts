import { z } from "zod";
import { Money } from "../domain/shared/money/money";
import { InvalidCurrencyError, InvalidMoneyAmountError } from "../domain/shared/money/money.errors";
import { OPENING_PROVIDER_ID } from "../domain/wagering/wager-transaction";
import { WagerTransactionKind } from "../domain/wagering/wager-transaction-kind";

const identifier = z.string().trim().min(1).max(255);

const money = z.object({ amount: z.unknown(), currency: z.unknown() }).transform((value, context) => {
  try {
    return Money.from({ amount: value.amount as string, currency: value.currency as string });
  } catch (error) {
    if (error instanceof InvalidMoneyAmountError || error instanceof InvalidCurrencyError) {
      context.addIssue({ code: "custom", message: error.message });
      return z.NEVER;
    }
    throw error;
  }
});

const positiveMoney = money.refine((value) => value.isPositive(), { message: "O valor deve ser maior que zero" });

const SUBMITTABLE_KINDS = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
] as const;

const REVERSAL_KINDS: readonly WagerTransactionKind[] = [WagerTransactionKind.Refund, WagerTransactionKind.Rollback];

export const uuidSchema = z.uuid();

export const idempotencyKeySchema = identifier;

export const providerReferenceSchema = z.object({ providerId: identifier, externalTransactionId: identifier });

export const createWalletSchema = z
  .object({ playerId: identifier, initialBalance: money })
  .transform(({ playerId, initialBalance }) => ({ playerId, initialBalance: initialBalance.toJSON() }));

const wagerTransactionFields = {
  providerId: identifier.refine((providerId) => providerId !== OPENING_PROVIDER_ID, {
    message: `O provider ${OPENING_PROVIDER_ID} é reservado`,
  }),
  externalTransactionId: identifier,
  playerId: identifier,
  walletId: z.uuid(),
  roundId: identifier,
  gameId: identifier,
  kind: z.enum(SUBMITTABLE_KINDS),
  money: positiveMoney,
  referenceExternalTransactionId: identifier.optional(),
};

const wagerTransactionObject = z.object(wagerTransactionFields);

const REVERSAL_REFERENCE_RULE = {
  message: "REFUND e ROLLBACK exigem referenceExternalTransactionId",
  path: ["referenceExternalTransactionId"],
};

function reversalHasReference(body: { kind: WagerTransactionKind; referenceExternalTransactionId?: string | undefined }) {
  return !REVERSAL_KINDS.includes(body.kind) || body.referenceExternalTransactionId !== undefined;
}

function moneyAsProps<Body extends { money: Money }>(body: Body) {
  return { ...body, money: body.money.toJSON() };
}

export const submitWagerTransactionSchema = wagerTransactionObject
  .refine(reversalHasReference, REVERSAL_REFERENCE_RULE)
  .transform(moneyAsProps);

export const wagerTransactionRequestedSchema = z.object({
  messageId: identifier,
  type: z.literal("WagerTransactionRequested"),
  occurredAt: z.iso.datetime(),
  data: wagerTransactionObject
    .extend({ idempotencyKey: identifier })
    .refine(reversalHasReference, REVERSAL_REFERENCE_RULE)
    .transform(moneyAsProps),
});

export type CreateWalletBody = z.output<typeof createWalletSchema>;
export type SubmitWagerTransactionBody = z.output<typeof submitWagerTransactionSchema>;
export type WagerTransactionRequested = z.output<typeof wagerTransactionRequestedSchema>;
