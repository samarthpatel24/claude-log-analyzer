import { UnifiedRecord, LogSeverity, PodLogResult, PodStatus, PodMetrics, K8sEvent } from "../types/unified-schema.js";
import { extractServiceName, formatBytes } from "../utils.js";

export function normalizeLogResults(results: PodLogResult[]): UnifiedRecord[] {
  const records: UnifiedRecord[] = [];

  for (const result of results) {
    // Extract service name from pod name (strip replica hash)
    const service = extractServiceName(result.podName);

    for (const entry of result.logs) {
      records.push({
        timestamp: entry.timestamp,
        service,
        pod: result.podName,
        namespace: result.namespace,
        source: "log",
        severity: entry.severity,
        message: entry.message,
      });
    }
  }

  return records;
}

export function normalizePodStatuses(statuses: PodStatus[]): UnifiedRecord[] {
  const records: UnifiedRecord[] = [];

  for (const pod of statuses) {
    const service = extractServiceName(pod.name);

    for (const container of pod.containers) {
      if (container.state !== "running" || container.restartCount > 0) {
        let severity: LogSeverity = "info";
        if (container.stateDetail === "CrashLoopBackOff" || container.lastTerminationReason === "OOMKilled") {
          severity = "error";
        } else if (container.state === "waiting") {
          severity = "warn";
        }

        records.push({
          timestamp: pod.startTime,
          service,
          pod: pod.name,
          namespace: pod.namespace,
          source: "status",
          severity,
          message: `Container ${container.name}: state=${container.stateDetail}, restarts=${container.restartCount}${container.lastTerminationReason ? `, lastTermination=${container.lastTerminationReason}` : ""}`,
        });
      }
    }
  }

  return records;
}

export function normalizeMetrics(metrics: PodMetrics[]): UnifiedRecord[] {
  const records: UnifiedRecord[] = [];

  for (const pod of metrics) {
    const service = extractServiceName(pod.name);

    for (const container of pod.containers) {
      const values: Record<string, number> = {
        cpuMillicores: container.cpuUsageMillicores,
        memoryBytes: container.memoryUsageBytes,
      };
      if (container.cpuUsagePercent !== undefined) values.cpuPercent = container.cpuUsagePercent;
      if (container.memoryUsagePercent !== undefined) values.memoryPercent = container.memoryUsagePercent;

      let severity: LogSeverity = "info";
      if ((container.cpuUsagePercent ?? 0) > 90 || (container.memoryUsagePercent ?? 0) > 90) severity = "error";
      else if ((container.cpuUsagePercent ?? 0) > 70 || (container.memoryUsagePercent ?? 0) > 70) severity = "warn";

      records.push({
        timestamp: new Date().toISOString(),
        service,
        pod: pod.name,
        namespace: pod.namespace,
        source: "metric",
        severity,
        message: `CPU: ${container.cpuUsageMillicores}m${container.cpuUsagePercent !== undefined ? ` (${container.cpuUsagePercent}%)` : ""}, Memory: ${formatBytes(container.memoryUsageBytes)}${container.memoryUsagePercent !== undefined ? ` (${container.memoryUsagePercent}%)` : ""}`,
        metricValues: values,
      });
    }
  }

  return records;
}

export function normalizeEvents(events: K8sEvent[]): UnifiedRecord[] {
  return events.map((e) => ({
    timestamp: e.timestamp,
    service: extractServiceName(e.involvedObject.name),
    pod: e.involvedObject.kind === "Pod" ? e.involvedObject.name : "",
    namespace: e.namespace,
    source: "event" as const,
    severity: e.type === "Warning" ? "warn" as const : "info" as const,
    message: `[${e.reason}] ${e.message} (${e.involvedObject.kind}/${e.involvedObject.name}, count: ${e.count})`,
  }));
}

export { extractServiceName, formatBytes } from "../utils.js";
