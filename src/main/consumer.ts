import { bootstrapWorker } from "./bootstrap-worker";
import { ConsumerModule } from "./consumer.module";

await bootstrapWorker(ConsumerModule);
