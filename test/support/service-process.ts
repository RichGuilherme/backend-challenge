import { expect } from "bun:test";

export type LogLine = Record<string, unknown>;

export interface TerminatedService {
  exitCode: number;
  stdout: string;
  stderr: string;
  logs: LogLine[];
}

export function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  void probe.stop(true);
  if (!port) throw new Error("não foi possível reservar uma porta");
  return port;
}

export class ServiceProcess {
  readonly port: number;
  private readonly child: ReturnType<typeof Bun.spawn>;
  private readonly stdout: Promise<string>;
  private readonly stderr: Promise<string>;

  constructor(entrypoint: string, env: Record<string, string>, portVariable: string) {
    this.port = freePort();
    this.child = Bun.spawn(["bun", "run", entrypoint], {
      env: { ...process.env, LOG_LEVEL: "info", ...env, [portVariable]: String(this.port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.stdout = new Response(this.child.stdout as ReadableStream).text();
    this.stderr = new Response(this.child.stderr as ReadableStream).text();
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async waitUntilReachable(path: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const reachable = await fetch(`${this.baseUrl}${path}`).then(
        () => true,
        () => false,
      );
      if (reachable) return;
      if (Date.now() > deadline) throw new Error(`${path} inacessível em ${this.baseUrl}`);
      await Bun.sleep(100);
    }
  }

  async expectOperational(): Promise<void> {
    const live = await fetch(`${this.baseUrl}/health/live`);
    const ready = await fetch(`${this.baseUrl}/health/ready`);
    const metrics = await fetch(`${this.baseUrl}/metrics`);

    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(metrics.status).toBe(200);
    expect(await metrics.text()).toContain("wagering_");
  }

  async terminate(): Promise<TerminatedService> {
    this.child.kill("SIGTERM");
    const exitCode = await this.child.exited;
    const [stdout, stderr] = await Promise.all([this.stdout, this.stderr]);
    return { exitCode, stdout, stderr, logs: parseLogLines(stdout) };
  }
}

export function parseLogLines(stdout: string): LogLine[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LogLine);
}

export function expectCleanShutdown(result: TerminatedService, startedMessage: string, stoppedMessage: string): void {
  expect([0, 128 + 15]).toContain(result.exitCode);
  const messages = result.logs.map((line) => line.msg);
  expect(messages).toContain(startedMessage);
  expect(messages).toContain(stoppedMessage);
  expect(messages).not.toContain("falha no ciclo do worker");
}
