import { SNSClient } from "@aws-sdk/client-sns";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { AwsConfig } from "../../shared/config/env";

function clientOptions({ region, endpoint }: AwsConfig) {
  return { region, ...(endpoint ? { endpoint } : {}) };
}

export function createSqsClient(config: AwsConfig): SQSClient {
  return new SQSClient(clientOptions(config));
}

export function createSnsClient(config: AwsConfig): SNSClient {
  return new SNSClient(clientOptions(config));
}
