import type { DependencyCheck } from "../ports/dependency-check";

export type DependencyStatus = { status: "up" } | { status: "down"; reason: string };

export interface ReadinessReport {
  ready: boolean;
  dependencies: Record<string, DependencyStatus>;
}

export class ReadinessProbe {
  constructor(
    private readonly checks: readonly DependencyCheck[],
    private readonly timeoutMs: number,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error(`Timeout do health inválido: ${timeoutMs}`);
  }

  async check(): Promise<ReadinessReport> {
    const results = await Promise.all(this.checks.map((check) => this.run(check)));
    return {
      ready: results.every(([, status]) => status.status === "up"),
      dependencies: Object.fromEntries(results),
    };
  }

  private async run(check: DependencyCheck): Promise<[string, DependencyStatus]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const timedOut = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener("abort", () => reject(new Error(`timeout após ${this.timeoutMs}ms`))),
    );
    try {
      await Promise.race([check.check(controller.signal), timedOut]);
      return [check.name, { status: "up" }];
    } catch (error) {
      return [check.name, { status: "down", reason: error instanceof Error ? error.message : String(error) }];
    } finally {
      clearTimeout(timer);
    }
  }
}
