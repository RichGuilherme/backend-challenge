import { v7 as uuidv7 } from "uuid";
import type { IdGenerator } from "../../application/ports/id-generator";

export class UuidV7IdGenerator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
