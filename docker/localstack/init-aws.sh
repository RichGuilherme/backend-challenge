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

echo "[init-aws] filas prontas: $QUEUE_NAME -> $DLQ_NAME (maxReceiveCount=$MAX_RECEIVE_COUNT)"

EVENTS_TOPIC_NAME="wager-events.fifo"
EVENTS_SUBSCRIBER_QUEUE_NAME="wager-events-subscriber.fifo"

TOPIC_ARN=$(awslocal --region "$REGION" sns create-topic \
  --name "$EVENTS_TOPIC_NAME" \
  --attributes FifoTopic=true,ContentBasedDeduplication=false \
  --query TopicArn --output text)

SUBSCRIBER_URL=$(awslocal --region "$REGION" sqs create-queue \
  --queue-name "$EVENTS_SUBSCRIBER_QUEUE_NAME" \
  --attributes FifoQueue=true --query QueueUrl --output text)
SUBSCRIBER_ARN=$(awslocal --region "$REGION" sqs get-queue-attributes \
  --queue-url "$SUBSCRIBER_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)

awslocal --region "$REGION" sns subscribe \
  --topic-arn "$TOPIC_ARN" --protocol sqs --notification-endpoint "$SUBSCRIBER_ARN" \
  --attributes RawMessageDelivery=true >/dev/null

echo "[init-aws] tópico pronto: $EVENTS_TOPIC_NAME -> $EVENTS_SUBSCRIBER_QUEUE_NAME"
