import type { PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { InvalidPayloadError } from "./invalid-payload.error";

export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.output<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new InvalidPayloadError(
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
}
