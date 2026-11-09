#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
DLQ_NAME="wager-transactions-dlq.fifo"
QUEUE_NAME="wager-transactions.fifo"
MAX_RECEIVE_COUNT="${SQS_MAX_RECEIVE_COUNT:-5}"

awslocal --region "$REGION" sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --attributes FifoQueue=true >/dev/null

DLQ_URL=$(awslocal --region "$REGION" sqs get-queue-url --queue-name "$DLQ_NAME" --query QueueUrl --output text)
DLQ_ARN=$(awslocal --region "$REGION" sqs get-queue-attributes \
  --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)

ATTRS="{\"FifoQueue\":\"true\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"${MAX_RECEIVE_COUNT}\\\"}\"}"

awslocal --region "$REGION" sqs create-queue \
  --queue-name "$QUEUE_NAME" \
  --attributes "$ATTRS" >/dev/null

echo "[init-sqs] filas prontas: $QUEUE_NAME -> $DLQ_NAME (maxReceiveCount=$MAX_RECEIVE_COUNT)"
