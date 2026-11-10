import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Cluster, loadTestEnv } from "../support/cluster";
import { LoadEnvironment } from "../support/load-environment";
import { LoadScenario } from "../support/load-scenario";
import { seededRandom } from "../support/random";

const SEED = Number(process.env.TEST_SEED ?? 20261110);
const WALLETS = 60;
const BETS_PER_WALLET = 12;
const RESTART_AT_PROGRESS = 0.3;
const DRAIN_TIMEOUT_MS = Number(process.env.TEST_DRAIN_TIMEOUT_MS ?? 150_000);

let environment: LoadEnvironment;
let cluster: Cluster | undefined;

beforeEach(async () => {
  environment = await LoadEnvironment.create();
  cluster = undefined;
});

afterEach(async () => {
  await cluster?.terminateAll();
  await environment?.close();
}, 60_000);

describe("reinício de todo o serviço no meio da carga", () => {
  test.each([
    ["SIGKILL", "queda geral, sem nenhum encerramento limpo"],
    ["SIGTERM", "deploy, com parada graciosa de todos os processos"],
  ] as const)(
    "%s (%s): a consistência final é comprovada",
    async (signal) => {
      const random = seededRandom(SEED);
      const scenario = new LoadScenario(
        { ...environment, cluster: () => cluster! },
        { wallets: WALLETS, betsPerWallet: BETS_PER_WALLET, random, seed: SEED },
      );
      const wallets = await scenario.openWallets();
      const operations = scenario.plan(wallets);

      cluster = new Cluster(loadTestEnv());
      await Promise.all([
        cluster.start("api", 2),
        cluster.start("consumer", 2),
        cluster.start("outbox-publisher", 2),
        cluster.start("reference-worker", 1),
      ]);

      const load = scenario.run(operations);
      while ((await scenario.progress()) < RESTART_AT_PROGRESS) await Bun.sleep(20);
      const progressAtRestart = await scenario.progress();
      const stopped = await cluster.restartAll(signal);
      await load;
      await scenario.drain(DRAIN_TIMEOUT_MS);

      expect(progressAtRestart).toBeGreaterThanOrEqual(RESTART_AT_PROGRESS);
      expect(progressAtRestart).toBeLessThan(1);
      expect(stopped).toHaveLength(7);
      if (signal === "SIGTERM") for (const service of stopped) expect([0, 128 + 15]).toContain(service.exitCode);
      await scenario.verifyFinalState(operations);

      for (const service of await cluster.terminateAll()) expect([0, 128 + 15]).toContain(service.exitCode);
    },
    420_000,
  );
});
