import { getCoreV1Api, getCustomObjectsApi } from "./client.js";
import { PodMetrics, ContainerMetrics } from "../types/unified-schema.js";

export interface GetMetricsOptions {
  namespace: string;
  podName?: string;
  labelSelector?: string;
}

function parseCpuValue(cpu: string): number {
  // Returns millicores
  if (cpu.endsWith("n")) return parseInt(cpu) / 1_000_000;
  if (cpu.endsWith("u")) return parseInt(cpu) / 1_000;
  if (cpu.endsWith("m")) return parseInt(cpu);
  return parseFloat(cpu) * 1000;
}

function parseMemoryValue(mem: string): number {
  // Returns bytes
  if (mem.endsWith("Ki")) return parseInt(mem) * 1024;
  if (mem.endsWith("Mi")) return parseInt(mem) * 1024 * 1024;
  if (mem.endsWith("Gi")) return parseInt(mem) * 1024 * 1024 * 1024;
  if (mem.endsWith("Ti")) return parseInt(mem) * 1024 * 1024 * 1024 * 1024;
  if (mem.endsWith("k")) return parseInt(mem) * 1000;
  if (mem.endsWith("M")) return parseInt(mem) * 1_000_000;
  if (mem.endsWith("G")) return parseInt(mem) * 1_000_000_000;
  return parseInt(mem);
}

export async function getResourceMetrics(opts: GetMetricsOptions): Promise<PodMetrics[]> {
  const customApi = getCustomObjectsApi();
  const coreApi = getCoreV1Api();

  // Fetch metrics from metrics-server
  let metricsItems: any[];
  try {
    if (opts.podName) {
      const response = await customApi.getNamespacedCustomObject({
        group: "metrics.k8s.io",
        version: "v1beta1",
        namespace: opts.namespace,
        plural: "pods",
        name: opts.podName,
      });
      metricsItems = [response];
    } else {
      const response = await customApi.listNamespacedCustomObject({
        group: "metrics.k8s.io",
        version: "v1beta1",
        namespace: opts.namespace,
        plural: "pods",
      });
      metricsItems = (response as any).items ?? [];
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Metrics API unavailable (is metrics-server installed?): ${message}`);
  }

  // Fetch pod specs for limits/requests
  const podSpecs = new Map<string, Map<string, { cpuReq?: number; cpuLim?: number; memReq?: number; memLim?: number }>>();

  const pods = await coreApi.listNamespacedPod({
    namespace: opts.namespace,
    labelSelector: opts.labelSelector,
  });

  for (const pod of pods.items ?? []) {
    const containerMap = new Map<string, { cpuReq?: number; cpuLim?: number; memReq?: number; memLim?: number }>();
    for (const container of pod.spec?.containers ?? []) {
      containerMap.set(container.name, {
        cpuReq: container.resources?.requests?.cpu ? parseCpuValue(String(container.resources.requests.cpu)) : undefined,
        cpuLim: container.resources?.limits?.cpu ? parseCpuValue(String(container.resources.limits.cpu)) : undefined,
        memReq: container.resources?.requests?.memory ? parseMemoryValue(String(container.resources.requests.memory)) : undefined,
        memLim: container.resources?.limits?.memory ? parseMemoryValue(String(container.resources.limits.memory)) : undefined,
      });
    }
    podSpecs.set(pod.metadata?.name ?? "", containerMap);
  }

  // Build results
  const results: PodMetrics[] = [];

  for (const item of metricsItems) {
    const podName = item.metadata?.name ?? "";
    const specs = podSpecs.get(podName);
    let totalCpu = 0;
    let totalMem = 0;
    const containers: ContainerMetrics[] = [];

    for (const c of item.containers ?? []) {
      const cpuUsage = parseCpuValue(c.usage?.cpu ?? "0");
      const memUsage = parseMemoryValue(c.usage?.memory ?? "0");
      const spec = specs?.get(c.name);

      totalCpu += cpuUsage;
      totalMem += memUsage;

      containers.push({
        name: c.name,
        cpuUsageMillicores: Math.round(cpuUsage),
        cpuRequestMillicores: spec?.cpuReq ? Math.round(spec.cpuReq) : undefined,
        cpuLimitMillicores: spec?.cpuLim ? Math.round(spec.cpuLim) : undefined,
        cpuUsagePercent: spec?.cpuLim ? Math.round((cpuUsage / spec.cpuLim) * 100) : undefined,
        memoryUsageBytes: Math.round(memUsage),
        memoryRequestBytes: spec?.memReq ? Math.round(spec.memReq) : undefined,
        memoryLimitBytes: spec?.memLim ? Math.round(spec.memLim) : undefined,
        memoryUsagePercent: spec?.memLim ? Math.round((memUsage / spec.memLim) * 100) : undefined,
      });
    }

    results.push({
      name: podName,
      namespace: opts.namespace,
      containers,
      totalCpuMillicores: Math.round(totalCpu),
      totalMemoryBytes: Math.round(totalMem),
    });
  }

  return results;
}
