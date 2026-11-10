import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ScriptEvent {
  listen: string;
  script: { exec: string[] };
}

interface RequestItem {
  name: string;
  event?: ScriptEvent[];
  request: { method: string; url: string; header: { key: string; value: string }[] };
}

interface FolderItem {
  name: string;
  item: RequestItem[];
}

interface Collection {
  info: { schema: string };
  event: ScriptEvent[];
  variable: { key: string; value: string }[];
  item: FolderItem[];
}

interface Environment {
  values: { key: string; value: string; enabled: boolean }[];
}

const DIRECTORY = join(import.meta.dir, "../../../docs/postman");

const read = <T>(file: string): T => JSON.parse(readFileSync(join(DIRECTORY, file), "utf8")) as T;

const collection = read<Collection>("wagering.postman_collection.json");
const environment = read<Environment>("local.postman_environment.json");
const requests = collection.item.flatMap((folder) => folder.item);
const everything = JSON.stringify(collection);

const README_ROUTES = [
  "GET /health/live",
  "GET /health/ready",
  "POST /wallets",
  "GET /wallets/:id",
  "GET /wallets/:id/ledger",
  "POST /wallets/:id/reconciliation",
  "POST /wagering/transactions",
  "GET /wagering/transactions/:id",
  "GET /providers/:id/wagering/transactions/:id",
];

const README_STATUSES = [200, 201, 202, 400, 401, 403, 404, 409, 422];

const IDENTIFIER_SEGMENT = /^(\{\{[^}]+\}\}.*|[0-9a-f]{8}-[0-9a-f-]{27})$/;

function routeOf(request: RequestItem["request"]): string {
  const path = request.url.replace("{{baseUrl}}", "").split("?")[0] ?? "";
  const segments = path.split("/").map((segment) => (IDENTIFIER_SEGMENT.test(segment) ? ":id" : segment));
  return `${request.method} ${segments.join("/")}`;
}

function scriptsOf(item: RequestItem, listen: string): string {
  return (item.event ?? [])
    .filter((event) => event.listen === listen)
    .flatMap((event) => event.script.exec)
    .join("\n");
}

describe("collection Postman dos cenários do README", () => {
  test("usa o formato v2.1 do Postman", () => {
    expect(collection.info.schema).toBe("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
  });

  test("cobre todas as rotas do README", () => {
    const covered = new Set(requests.map((item) => routeOf(item.request)));
    for (const route of README_ROUTES) expect(covered.has(route)).toBe(true);
  });

  test("não chama rota fora do README", () => {
    const known = new Set(README_ROUTES);
    for (const item of requests) expect(known.has(routeOf(item.request))).toBe(true);
  });

  test("exercita os status HTTP que distinguem as situações da API", () => {
    const asserted = new Set(
      [...everything.matchAll(/pm\.response\.to\.have\.status\((\d+)\)/g)].map((match) => Number(match[1])),
    );
    for (const status of README_STATUSES) expect(asserted.has(status)).toBe(true);
  });

  test("todo request afirma o resultado com pm.test", () => {
    for (const item of requests) expect(scriptsOf(item, "test")).toContain("pm.test(");
  });

  test("todo POST de transação envia Idempotency-Key, exceto o caso que prova a ausência", () => {
    const submissions = requests.filter((item) => routeOf(item.request) === "POST /wagering/transactions");
    const withoutKey = submissions.filter((item) => !item.request.header.some((h) => h.key === "Idempotency-Key"));
    expect(withoutKey.map((item) => item.name)).toEqual(["BET sem header Idempotency-Key → 400"]);
  });

  test("busca o token do Keycloak antes de cada request", () => {
    const script = collection.event.flatMap((event) => event.script.exec).join("\n");
    expect(script).toContain("client_credentials");
    expect(script).toContain("accessToken");
  });
});

describe("variáveis da collection", () => {
  const defined = new Set(collection.variable.map((variable) => variable.key));
  const assigned = new Set(
    [...everything.matchAll(/collectionVariables\.set\(\\"(\w+)\\"/g)].map((match) => match[1] as string),
  );

  test("toda variável referenciada é definida ou atribuída por script", () => {
    const referenced = new Set(
      [...everything.matchAll(/\{\{([^}]+)\}\}/g)]
        .map((match) => match[1] as string)
        .filter((name) => !name.startsWith("$")),
    );
    for (const name of referenced) expect(defined.has(name) || assigned.has(name)).toBe(true);
  });

  test("o environment define as mesmas variáveis de entrada da collection", () => {
    expect(environment.values.map((value) => value.key).sort()).toEqual([...defined].sort());
  });

  test("o environment aponta para a stack do Compose", () => {
    const values = Object.fromEntries(environment.values.map((value) => [value.key, value.value]));
    expect(values.baseUrl).toBe("http://localhost:3000");
    expect(values.tokenUrl).toBe("http://localhost:8081/realms/wagering/protocol/openid-connect/token");
    expect(values.clientId).toBe("provider-a");
  });
});
