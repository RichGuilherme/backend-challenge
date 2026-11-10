import { Controller, Get, Inject, Res } from "@nestjs/common";
import { OpsEndpoints, type OpsResponse } from "../ops/ops-endpoints";

interface ResponseWriter {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

@Controller()
export class OpsController {
  constructor(@Inject(OpsEndpoints) private readonly ops: OpsEndpoints) {}

  @Get("health/live")
  async live(@Res({ passthrough: true }) response: ResponseWriter): Promise<unknown> {
    return write(response, await this.ops.live());
  }

  @Get("health/ready")
  async ready(@Res({ passthrough: true }) response: ResponseWriter): Promise<unknown> {
    return write(response, await this.ops.ready());
  }

  @Get("metrics")
  async metrics(@Res({ passthrough: true }) response: ResponseWriter): Promise<unknown> {
    return write(response, await this.ops.metrics());
  }
}

function write(response: ResponseWriter, { status, contentType, body }: OpsResponse): unknown {
  response.status(status);
  response.setHeader("content-type", contentType);
  return body;
}
