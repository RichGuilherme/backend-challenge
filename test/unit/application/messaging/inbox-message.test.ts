import { describe, expect, test } from "bun:test";
import { InboxMessage } from "../../../../src/application/messaging/inbox-message";

const receivedAt = new Date("2026-11-10T12:00:00.000Z");
const processedAt = new Date("2026-11-10T12:00:01.000Z");

const receive = () =>
  InboxMessage.receive({ messageId: "msg-1", consumerName: "wager-consumer", payloadHash: "hash-1", receivedAt });

describe("InboxMessage", () => {
  test("receive nasce não processada", () => {
    const message = receive();
    expect(message.messageId).toBe("msg-1");
    expect(message.consumerName).toBe("wager-consumer");
    expect(message.payloadHash).toBe("hash-1");
    expect(message.receivedAt).toEqual(receivedAt);
    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  test("markProcessed registra o instante", () => {
    const message = receive();
    message.markProcessed(processedAt);
    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(processedAt);
  });

  test("processar duas vezes é erro de programação", () => {
    const message = receive();
    message.markProcessed(processedAt);
    expect(() => message.markProcessed(processedAt)).toThrow();
  });

  test("rehydrate reconstrói sem revalidar", () => {
    const message = InboxMessage.rehydrate({
      messageId: "msg-2",
      consumerName: "wager-consumer",
      payloadHash: "hash-2",
      receivedAt,
      processedAt,
    });
    expect(message.isProcessed()).toBe(true);
  });
});
