import { resolve } from "node:path";
import { ServiceProcess, type TerminatedService } from "./service-process";

export type Role = "api" | "consumer" | "outbox-publisher" | "reference-worker";

const ENTRYPOINTS: Record<Role, string> = {
  api: resolve(import.meta.dir, "../../src/main/main.ts"),
  consumer: resolve(import.meta.dir, "../../src/main/consumer.ts"),
  "outbox-publisher": resolve(import.meta.dir, "../../src/main/outbox-publisher.ts"),
  "reference-worker": resolve(import.meta.dir, "../../src/main/reference-worker.ts"),
};

const PORT_VARIABLE: Record<Role, string> = {
  api: "PORT",
  consumer: "OPS_PORT",
  "outbox-publisher": "OPS_PORT",
  "reference-worker": "OPS_PORT",
};

export interface KillRecord {
  role: Role;
  index: number;
  at: number;
}

export class Cluster {
  private readonly slots = new Map<Role, (ServiceProcess | undefined)[]>();
  private readonly spawned = new Set<ServiceProcess>();
  private readonly retired: Promise<TerminatedService>[] = [];
  readonly kills: KillRecord[] = [];

  constructor(private readonly env: Record<string, string>) {}

  async start(role: Role, count: number): Promise<void> {
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

  async terminateAll(): Promise<TerminatedService[]> {
    const live = [...this.spawned];
    this.spawned.clear();
    this.slots.clear();
    const results = await Promise.all(live.map((instance) => instance.terminate()));
    await Promise.all(this.retired);
    return results;
  }

  private async spawn(role: Role): Promise<ServiceProcess> {
    const instance = new ServiceProcess(ENTRYPOINTS[role], { ...this.env, SERVICE_NAME: role }, PORT_VARIABLE[role]);
    this.spawned.add(instance);
    await instance.waitUntilReachable("/health/live");
    return instance;
  }
}
