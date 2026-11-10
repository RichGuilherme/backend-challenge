import { bootstrapWorker } from "./bootstrap-worker";
import { ReferenceWorkerModule } from "./reference-worker.module";

await bootstrapWorker(ReferenceWorkerModule);
