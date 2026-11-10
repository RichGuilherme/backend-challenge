import { testDatabaseConfig } from "./database";
import { ServiceProcess, type Role, type TerminatedService } from "./service-process";

export type { Role };

export interface KillRecord {
  role: Role;
  index: number;
  at: number;
}

export class Cluster {
  private readonly slots = new Map<Role, (ServiceProcess | undefined)[]>();
  private readonly topology = new Map<Role, number>();
  private readonly spawned = new Set<ServiceProcess>();
  private readonly retired: Promise<TerminatedService>[] = [];
  readonly kills: KillRecord[] = [];

  constructor(private readonly env: Record<string, string>) {}

  async start(role: Role, count: number): Promise<void> {
    this.topology.set(role, count);
    const started = await Promise.all(Array.from({ length: count }, () => this.spawn(role)));
    this.slots.set(role, started);
  }

  private liveIndexes(role: Role): number[] {
    return (this.slots.get(role) ?? []).flatMap((instance, index) => (instance ? [index] : []));
  }

  liveApis(): ServiceProcess[] {
    return (this.slots.get("api") ?? []).filter((instance): instance is ServiceProcess => instance !== undefined);
  }

  async killRandom(role: Role, random: () => number): Promise<void> {
    let live = this.liveIndexes(role);
    while (live.length === 0) {
      await Bun.sleep(50);
      live = this.liveIndexes(role);
    }
    await this.killAndReplace(role, live[Math.floor(random() * live.length)]!);
  }

  private async killAndReplace(role: Role, index: number): Promise<void> {
    const group = this.slots.get(role);
    const victim = group?.[index];
    if (!group || !victim) throw new Error(`Sem instância ${role}[${index}]`);
    group[index] = undefined;
    this.kills.push({ role, index, at: Date.now() });
    this.spawned.delete(victim);
    this.retired.push(victim.terminate("SIGKILL"));
    group[index] = await this.spawn(role);
  }

  async restartAll(signal: NodeJS.Signals): Promise<TerminatedService[]> {
    const stopped = await this.stopEverything(signal);
    await Promise.all([...this.topology].map(([role, count]) => this.start(role, count)));
    return stopped;
  }

  async terminateAll(): Promise<TerminatedService[]> {
    const results = await this.stopEverything("SIGTERM");
    await Promise.all(this.retired);
    return results;
  }

  private async stopEverything(signal: NodeJS.Signals): Promise<TerminatedService[]> {
    const live = [...this.spawned];
    this.spawned.clear();
    this.slots.clear();
    return Promise.all(live.map((instance) => instance.terminate(signal)));
  }

  private async spawn(role: Role): Promise<ServiceProcess> {
    const instance = new ServiceProcess(role, { ...this.env, SERVICE_NAME: role });
    this.spawned.add(instance);
    await instance.waitUntilReachable("/health/live");
    return instance;
  }
}

export function loadTestEnv(): Record<string, string> {
  return {
    DB_NAME: testDatabaseConfig().name,
    LOG_LEVEL: "error",
    DB_LOCK_TIMEOUT_MS: "10000",
    OUTBOX_POLL_INTERVAL_MS: "100",
    PENDING_REFERENCE_POLL_INTERVAL_MS: "200",
    PENDING_REFERENCE_RETRY_BASE_MS: "200",
    PENDING_REFERENCE_RETRY_CAP_MS: "2000",
  };
}
