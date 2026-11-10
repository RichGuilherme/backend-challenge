import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const ENTRYPOINT = resolve(import.meta.dir, "../../../src/main/main.ts");

async function run(...args: string[]) {
  const child = Bun.spawn(["bun", "run", ENTRYPOINT, ...args], {
    env: { ...process.env, LOG_LEVEL: "info" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("entrypoint único", () => {
  test("papel desconhecido encerra com erro e lista os papéis válidos, sem subir nada", async () => {
    const result = await run("inexistente");

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("inexistente");
    for (const role of ["api", "consumer", "outbox-publisher", "reference-worker"]) {
      expect(result.stderr).toContain(role);
    }
  });
});
