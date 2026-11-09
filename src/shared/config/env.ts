export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    host: requireEnv("DB_HOST", env),
    port: Number.parseInt(requireEnv("DB_PORT", env), 10),
    name: requireEnv("DB_NAME", env),
    user: requireEnv("DB_USER", env),
    password: requireEnv("DB_PASSWORD", env),
  };
}
