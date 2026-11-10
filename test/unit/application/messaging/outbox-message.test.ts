import { describe, expect, test } from "bun:test";
import { OutboxMessage } from "../../../../src/application/messaging/outbox-message";
import { WalletBalanceChanged } from "../../../../src/application/messaging/integration-events";
import { Wallet } from "../../../../src/domain/wallet/wallet";
import { brl } from "../../../support/money";

const occurredAt = new Date("2026-11-09T12:00:00.000Z");
const policy = { baseMs: 1_000, capMs: 300_000 };

function event() {
  const { wallet } = Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: brl("100.00"),
    at: occurredAt,
    opening: { transactionId: "tx-opening", entryId: "entry-opening" },
  });
  const entry = wallet.credit({ entryId: "entry-1", transactionId: "tx-1", money: brl("1.00"), at: occurredAt });
  return WalletBalanceChanged.from(wallet, entry, {
    eventId: "event-1",
    correlationId: "corr-1",
    causationId: undefined,
    occurredAt,
  });
}

const later = (ms: number) => new Date(occurredAt.getTime() + ms);

describe("OutboxMessage", () => {
  test("enqueue guarda o envelope serializado e nasce pendente e devido", () => {
    const message = OutboxMessage.enqueue(event());

    expect(message.id).toBe("event-1");
    expect(message.aggregateId).toBe("wallet-1");
    expect(message.partitionKey).toBe("wallet-1");
    expect(message.eventType).toBe("WalletBalanceChanged");
    expect(message.payload).toEqual(JSON.parse(JSON.stringify(event())));
    expect(message.attempts).toBe(0);
    expect(message.isPending()).toBe(true);
    expect(message.isDue(occurredAt)).toBe(true);
    expect(message.publishedAt).toBeUndefined();
  });

  test("markPublished encerra a mensagem", () => {
    const message = OutboxMessage.enqueue(event());
    message.markPublished(later(10));
    expect(message.isPending()).toBe(false);
    expect(message.isDue(later(10_000))).toBe(false);
    expect(message.publishedAt).toEqual(later(10));
  });

  test("publicar duas vezes é erro de programação", () => {
    const message = OutboxMessage.enqueue(event());
    message.markPublished(later(10));
    expect(() => message.markPublished(later(20))).toThrow();
  });

  test("scheduleRetry incrementa tentativas e agenda com full jitter", () => {
    const message = OutboxMessage.enqueue(event());

    message.scheduleRetry(later(0), policy, () => 0.5);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(later(1_000));
    expect(message.isDue(later(999))).toBe(false);
    expect(message.isDue(later(1_000))).toBe(true);

    message.scheduleRetry(later(1_000), policy, () => 0.5);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(later(3_000));
  });

  test("não há limite de tentativas: o evento confirmado nunca é descartado", () => {
    const message = OutboxMessage.enqueue(event());
    for (let attempt = 0; attempt < 100; attempt += 1) message.scheduleRetry(later(0), policy, () => 0.5);
    expect(message.attempts).toBe(100);
    expect(message.isPending()).toBe(true);
  });

  test("scheduleRetry depois de publicada é erro de programação", () => {
    const message = OutboxMessage.enqueue(event());
    message.markPublished(later(10));
    expect(() => message.scheduleRetry(later(20), policy, () => 0.5)).toThrow();
  });
});
