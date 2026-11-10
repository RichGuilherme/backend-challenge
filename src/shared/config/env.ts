type Env = NodeJS.ProcessEnv;

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export interface AwsConfig {
  region: string;
  endpoint: string | undefined;
}

export interface OutboxConfig {
  topicArn: string;
  batchSize: number;
  pollIntervalMs: number;
  retry: { baseMs: number; capMs: number };
}

export function requireEnv(name: string, env: Env = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

export function requirePositiveInteger(name: string, env: Env = process.env): number {
  const raw = requireEnv(name, env);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== raw) {
    throw new Error(`${name} deve ser inteiro positivo: ${raw}`);
  }
  return value;
}

export function loadDatabaseConfig(env: Env = process.env): DatabaseConfig {
  return {
    host: requireEnv("DB_HOST", env),
    port: requirePositiveInteger("DB_PORT", env),
    name: requireEnv("DB_NAME", env),
    user: requireEnv("DB_USER", env),
    password: requireEnv("DB_PASSWORD", env),
  };
}

export function loadLockTimeoutMs(env: Env = process.env): number {
  return requirePositiveInteger("DB_LOCK_TIMEOUT_MS", env);
}

export function loadAwsConfig(env: Env = process.env): AwsConfig {
  return { region: requireEnv("AWS_REGION", env), endpoint: env.AWS_ENDPOINT_URL || undefined };
}

export function loadOutboxConfig(env: Env = process.env): OutboxConfig {
  return {
    topicArn: requireEnv("SNS_EVENTS_TOPIC_ARN", env),
    batchSize: requirePositiveInteger("OUTBOX_BATCH_SIZE", env),
    pollIntervalMs: requirePositiveInteger("OUTBOX_POLL_INTERVAL_MS", env),
    retry: {
      baseMs: requirePositiveInteger("OUTBOX_RETRY_BASE_MS", env),
      capMs: requirePositiveInteger("OUTBOX_RETRY_CAP_MS", env),
    },
  };
}

export interface PendingReferenceConfig {
  pollIntervalMs: number;
  policy: { ttlMs: number; backoff: { baseMs: number; capMs: number } };
}

export function loadPendingReferenceConfig(env: Env = process.env): PendingReferenceConfig {
  return {
    pollIntervalMs: requirePositiveInteger("PENDING_REFERENCE_POLL_INTERVAL_MS", env),
    policy: {
      ttlMs: requirePositiveInteger("PENDING_REFERENCE_TTL_MS", env),
      backoff: {
        baseMs: requirePositiveInteger("PENDING_REFERENCE_RETRY_BASE_MS", env),
        capMs: requirePositiveInteger("PENDING_REFERENCE_RETRY_CAP_MS", env),
      },
    },
  };
}

export interface ConsumerConfig {
  queueName: string;
  deadLetterQueueName: string;
  batchSize: number;
  waitSeconds: number;
  retry: { baseMs: number; capMs: number };
}

export function loadConsumerConfig(env: Env = process.env): ConsumerConfig {
  return {
    queueName: requireEnv("SQS_QUEUE_NAME", env),
    deadLetterQueueName: requireEnv("SQS_DLQ_NAME", env),
    batchSize: requirePositiveInteger("SQS_CONSUMER_BATCH_SIZE", env),
    waitSeconds: requirePositiveInteger("SQS_CONSUMER_WAIT_SECONDS", env),
    retry: {
      baseMs: requirePositiveInteger("SQS_RETRY_BASE_MS", env),
      capMs: requirePositiveInteger("SQS_RETRY_CAP_MS", env),
    },
  };
}

export interface LoggingConfig {
  service: string;
  level: string;
}

export function loadLoggingConfig(env: Env = process.env): LoggingConfig {
  return { service: env.SERVICE_NAME || "wagering", level: env.LOG_LEVEL || "info" };
}

export function loadHealthTimeoutMs(env: Env = process.env): number {
  return requirePositiveInteger("HEALTH_CHECK_TIMEOUT_MS", env);
}

export function loadOpsPort(env: Env = process.env): number {
  return requirePositiveInteger("OPS_PORT", env);
}

export function loadMaxReceives(env: Env = process.env): number {
  return requirePositiveInteger("SQS_MAX_RECEIVE_COUNT", env);
}
