import { bootstrapWorker } from "./bootstrap-worker";
import { OutboxPublisherModule } from "./outbox-publisher.module";

await bootstrapWorker(OutboxPublisherModule);
