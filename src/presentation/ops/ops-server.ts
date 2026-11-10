import type { OpsEndpoints, OpsResponse } from "./ops-endpoints";

type Route = (endpoints: OpsEndpoints) => Promise<OpsResponse>;

const ROUTES: Readonly<Record<string, Route>> = {
  "/health/live": (endpoints) => endpoints.live(),
  "/health/ready": (endpoints) => endpoints.ready(),
  "/metrics": (endpoints) => endpoints.metrics(),
};

export class OpsServer {
  private server: ReturnType<typeof Bun.serve> | undefined;

  constructor(
    private readonly endpoints: OpsEndpoints,
    private readonly requestedPort: number,
  ) {}

  get port(): number {
    if (!this.server?.port) throw new Error("OpsServer não está em execução");
    return this.server.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve({
      port: this.requestedPort,
      fetch: (request) => this.handle(request),
    });
  }

  async stop(): Promise<void> {
    await this.server?.stop(true);
    this.server = undefined;
  }

  private async handle(request: Request): Promise<Response> {
    const route = request.method === "GET" ? ROUTES[new URL(request.url).pathname] : undefined;
    if (!route) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    const { status, contentType, body } = await route(this.endpoints);
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, { status, headers: { "content-type": contentType } });
  }
}
