import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Cluster, loadTestEnv, type Role } from "../support/cluster";
import { LoadEnvironment } from "../support/load-environment";
import { LoadScenario } from "../support/load-scenario";
import { seededRandom, type RandomSource } from "../support/random";

const SEED = Number(process.env.TEST_SEED ?? 20261110);
const WALLETS = 100;
const BETS_PER_WALLET = 20;
const DRAIN_TIMEOUT_MS = Number(process.env.TEST_DRAIN_TIMEOUT_MS ?? 150_000);

interface KillPlan {
  role: Role;
  atProgress: number;
}

const KILL_PLAN: readonly KillPlan[] = [
  { role: "consumer", atProgress: 0.08 },
  { role: "api", atProgress: 0.15 },
  { role: "consumer", atProgress: 0.2 },
  { role: "outbox-publisher", atProgress: 0.25 },
  { role: "consumer", atProgress: 0.3 },
  { role: "consumer", atProgress: 0.4 },
  { role: "reference-worker", atProgress: 0.45 },
  { role: "consumer", atProgress: 0.5 },
  { role: "api", atProgress: 0.6 },
  { role: "outbox-publisher", atProgress: 0.7 },
];

let environment: LoadEnvironment;
let cluster: Cluster | undefined;

beforeAll(async () => {
  environment = await LoadEnvironment.create();
});

afterAll(async () => {
  await cluster?.terminateAll();
  await environment?.close();
}, 60_000);

async function killWhenReached(scenario: LoadScenario, plan: KillPlan, random: RandomSource): Promise<void> {
  while ((await scenario.progress()) < plan.atProgress) await Bun.sleep(25);
  if (plan.role === "consumer") {
    const patience = Date.now() + 10_000;
    while ((await environment.harness.messagesInQueue()).inFlight === 0 && Date.now() < patience) await Bun.sleep(10);
  }
  await cluster?.killRandom(plan.role, random);
}

describe("múltiplas instâncias reais sob carga, com processos mortos no meio", () => {
  test("3 APIs, 3 consumidores, 3 publicadores e 1 worker de referências: nada duplica, nada se perde", async () => {
    const random = seededRandom(SEED);
    const scenario = new LoadScenario(
      { ...environment, cluster: () => cluster! },
      { wallets: WALLETS, betsPerWallet: BETS_PER_WALLET, random, seed: SEED },
    );
    const operations = scenario.plan(await scenario.openWallets());

    cluster = new Cluster(loadTestEnv());
    await Promise.all([
      cluster.start("api", 3),
      cluster.start("consumer", 3),
      cluster.start("outbox-publisher", 3),
      cluster.start("reference-worker", 1),
    ]);

    const killers = KILL_PLAN.map((plan) => killWhenReached(scenario, plan, random));
    await scenario.run(operations);
    await Promise.all(killers);
    await scenario.drain(DRAIN_TIMEOUT_MS);

    expect(cluster.kills.map((kill) => kill.role).sort()).toEqual(KILL_PLAN.map((plan) => plan.role).sort());
    await scenario.verifyFinalState(operations);

    for (const service of await cluster.terminateAll()) expect([0, 128 + 15]).toContain(service.exitCode);
  }, 420_000);
});
