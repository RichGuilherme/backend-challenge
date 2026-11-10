export function workerErrorLogger(worker: string): (error: unknown) => void {
  return (error) => console.error(JSON.stringify({ level: "error", worker, msg: "falha no ciclo do worker", error: String(error) }));
}
