export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente ausente: ${name} (copie .env.example para .env)`);
  }
  return value;
}

export const testDb = {
  host: () => requireEnv("DB_HOST"),
  port: () => Number.parseInt(requireEnv("DB_PORT"), 10),
  dbName: () => requireEnv("DB_NAME"),
  user: () => requireEnv("DB_USER"),
  password: () => requireEnv("DB_PASSWORD"),
};

export const testSqs = {
  endpoint: () => requireEnv("AWS_ENDPOINT_URL"),
  region: () => requireEnv("AWS_REGION"),
  queueName: () => requireEnv("SQS_QUEUE_NAME"),
  dlqName: () => requireEnv("SQS_DLQ_NAME"),
};
