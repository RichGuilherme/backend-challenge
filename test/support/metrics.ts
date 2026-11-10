import type { Registry } from "prom-client";

export async function sampleOf(
  registry: Registry,
  metricName: string,
  labels: Record<string, string> = {},
): Promise<number | undefined> {
  for (const metric of await registry.getMetricsAsJSON()) {
    for (const sample of metric.values) {
      const name = "metricName" in sample && typeof sample.metricName === "string" ? sample.metricName : metric.name;
      const matches = Object.entries(labels).every(([key, value]) => sample.labels[key] === value);
      if (name === metricName && matches) return sample.value;
    }
  }
  return undefined;
}

export function expositionValue(
  exposition: string,
  metricName: string,
  labels: Record<string, string> = {},
): number | undefined {
  const rendered = Object.entries(labels)
    .map(([key, value]) => `${key}="${value}"`)
    .join(",");
  const prefix = rendered ? `${metricName}{${rendered}} ` : `${metricName} `;
  const line = exposition.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : Number(line.slice(prefix.length));
}
