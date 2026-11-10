import { GetQueueAttributesCommand, SetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import type { WagerQueueHarness } from "./wager-queue";

export async function shortenVisibilityTimeout(
  harness: WagerQueueHarness,
  seconds: number,
): Promise<() => Promise<void>> {
  const { queueUrl } = harness.urls;
  const original = (
    await harness.client.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["VisibilityTimeout"] }),
    )
  ).Attributes?.VisibilityTimeout;
  const apply = (value: string) =>
    harness.client.send(
      new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: { VisibilityTimeout: value } }),
    );
  await apply(String(seconds));
  return async () => {
    if (original) await apply(original);
  };
}
