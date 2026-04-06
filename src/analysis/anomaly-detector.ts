import { Anomaly, AnomalyType } from "../types/anomaly.js";
import { PodLogResult, PodStatus, PodMetrics, K8sEvent, Severity } from "../types/unified-schema.js";

interface AnomalyDetectorInput {
  logs?: PodLogResult[];
  podStatuses?: PodStatus[];
  metrics?: PodMetrics[];
  events?: K8sEvent[];
  timeWindowMinutes: number;
}

export function detectAnomalies(input: AnomalyDetectorInput): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (input.podStatuses) {
    anomalies.push(...detectOOMKills(input.podStatuses));
    anomalies.push(...detectRestartStorms(input.podStatuses));
  }

  if (input.metrics) {
    anomalies.push(...detectResourceSpikes(input.metrics));
  }

  if (input.logs) {
    anomalies.push(...detectErrorBursts(input.logs, input.timeWindowMinutes));
  }

  if (input.events) {
    anomalies.push(...detectEventFloods(input.events));
  }

  // Sort by severity (critical first) then timestamp
  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.timestamp.localeCompare(b.timestamp));

  return anomalies;
}

function extractServiceName(podName: string): string {
  const parts = podName.split("-");
  if (parts.length >= 3) {
    let end = parts.length;
    while (end > 1 && /^[a-z0-9]{4,10}$/.test(parts[end - 1])) end--;
    return parts.slice(0, Math.max(1, end)).join("-");
  }
  return podName;
}

function detectOOMKills(statuses: PodStatus[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const pod of statuses) {
    for (const container of pod.containers) {
      if (container.lastTerminationReason === "OOMKilled") {
        anomalies.push({
          type: "oom_kill",
          severity: "critical",
          timestamp: pod.startTime,
          service: extractServiceName(pod.name),
          pod: pod.name,
          namespace: pod.namespace,
          description: `Container '${container.name}' was OOM killed (exit code: ${container.lastTerminationExitCode ?? "unknown"})`,
          evidence: {
            metric: "memory",
            eventReason: "OOMKilled",
            currentValue: container.restartCount,
          },
        });
      }
    }
  }

  return anomalies;
}

function detectRestartStorms(statuses: PodStatus[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const pod of statuses) {
    let totalRestarts = 0;
    let isCrashLoop = false;

    for (const container of pod.containers) {
      totalRestarts += container.restartCount;
      if (container.stateDetail === "CrashLoopBackOff") isCrashLoop = true;
    }

    if (totalRestarts > 2) {
      let severity: Severity = "medium";
      if (totalRestarts > 10 || isCrashLoop) severity = "critical";
      else if (totalRestarts > 5) severity = "high";

      anomalies.push({
        type: "restart_storm",
        severity,
        timestamp: pod.startTime,
        service: extractServiceName(pod.name),
        pod: pod.name,
        namespace: pod.namespace,
        description: `Pod has ${totalRestarts} restarts${isCrashLoop ? " (CrashLoopBackOff)" : ""}`,
        evidence: {
          currentValue: totalRestarts,
          threshold: 3,
          eventReason: isCrashLoop ? "CrashLoopBackOff" : undefined,
        },
      });
    }
  }

  return anomalies;
}

function detectResourceSpikes(metrics: PodMetrics[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Group by service for peer comparison
  const serviceGroups = new Map<string, PodMetrics[]>();
  for (const pod of metrics) {
    const svc = extractServiceName(pod.name);
    if (!serviceGroups.has(svc)) serviceGroups.set(svc, []);
    serviceGroups.get(svc)!.push(pod);
  }

  for (const pod of metrics) {
    const service = extractServiceName(pod.name);
    const peers = serviceGroups.get(service) ?? [];

    for (const container of pod.containers) {
      // CPU spike detection
      if (container.cpuUsagePercent !== undefined) {
        let severity: Severity | null = null;
        if (container.cpuUsagePercent > 90) severity = "critical";
        else if (container.cpuUsagePercent > 70) severity = "high";
        else if (container.cpuUsagePercent > 50) severity = "medium";

        // Peer comparison z-score
        if (peers.length > 2) {
          const peerCpuValues = peers.flatMap((p) =>
            p.containers.filter((c) => c.name === container.name).map((c) => c.cpuUsageMillicores)
          );
          const zScore = computeZScore(container.cpuUsageMillicores, peerCpuValues);
          if (zScore > 2.5 && !severity) severity = "medium";
          if (zScore > 3.5 && severity !== "critical") severity = "high";

          if (severity) {
            anomalies.push({
              type: "cpu_spike",
              severity,
              timestamp: new Date().toISOString(),
              service,
              pod: pod.name,
              namespace: pod.namespace,
              description: `CPU usage at ${container.cpuUsagePercent}% of limit (${container.cpuUsageMillicores}m/${container.cpuLimitMillicores}m)`,
              evidence: {
                metric: "cpu",
                currentValue: container.cpuUsageMillicores,
                baselineValue: mean(peerCpuValues),
                zScore,
                threshold: container.cpuLimitMillicores,
              },
            });
          }
        } else if (severity) {
          anomalies.push({
            type: "cpu_spike",
            severity,
            timestamp: new Date().toISOString(),
            service,
            pod: pod.name,
            namespace: pod.namespace,
            description: `CPU usage at ${container.cpuUsagePercent}% of limit (${container.cpuUsageMillicores}m/${container.cpuLimitMillicores}m)`,
            evidence: {
              metric: "cpu",
              currentValue: container.cpuUsageMillicores,
              threshold: container.cpuLimitMillicores,
            },
          });
        }
      }

      // Memory spike detection
      if (container.memoryUsagePercent !== undefined) {
        let severity: Severity | null = null;
        if (container.memoryUsagePercent > 90) severity = "critical";
        else if (container.memoryUsagePercent > 70) severity = "high";
        else if (container.memoryUsagePercent > 50) severity = "medium";

        if (severity) {
          const peerMemValues = peers.flatMap((p) =>
            p.containers.filter((c) => c.name === container.name).map((c) => c.memoryUsageBytes)
          );
          const zScore = peers.length > 2 ? computeZScore(container.memoryUsageBytes, peerMemValues) : undefined;

          anomalies.push({
            type: "memory_spike",
            severity,
            timestamp: new Date().toISOString(),
            service,
            pod: pod.name,
            namespace: pod.namespace,
            description: `Memory usage at ${container.memoryUsagePercent}% of limit (${formatBytes(container.memoryUsageBytes)}/${formatBytes(container.memoryLimitBytes ?? 0)})`,
            evidence: {
              metric: "memory",
              currentValue: container.memoryUsageBytes,
              baselineValue: peerMemValues.length > 0 ? mean(peerMemValues) : undefined,
              zScore,
              threshold: container.memoryLimitBytes,
            },
          });
        }
      }
    }
  }

  return anomalies;
}

function detectErrorBursts(logs: PodLogResult[], timeWindowMinutes: number): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const podLog of logs) {
    const service = extractServiceName(podLog.podName);
    const errorLines = podLog.logs.filter((l) => l.severity === "error");
    if (errorLines.length === 0) continue;

    // Bucket errors into 1-minute intervals
    const buckets = new Map<string, string[]>();
    for (const entry of errorLines) {
      const bucketKey = entry.timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
      buckets.get(bucketKey)!.push(entry.message);
    }

    const counts = [...buckets.values()].map((msgs) => msgs.length);
    if (counts.length === 0) continue;

    const avg = mean(counts);
    const std = stddev(counts);
    const maxCount = Math.max(...counts);

    // Flag if any bucket exceeds mean + 3*stddev or absolute threshold of 10
    const threshold = std > 0 ? avg + 3 * std : avg * 3;
    const isAnomaly = maxCount > threshold || maxCount > 10;

    if (isAnomaly) {
      // Find the bucket with max errors for sample lines
      const worstBucket = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)[0];
      const sampleLines = worstBucket[1].slice(0, 3);

      let severity: Severity = "medium";
      if (maxCount > avg * 10 || maxCount > 50) severity = "critical";
      else if (maxCount > avg * 5 || maxCount > 20) severity = "high";

      anomalies.push({
        type: "error_burst",
        severity,
        timestamp: worstBucket[0] + ":00Z",
        service,
        pod: podLog.podName,
        namespace: podLog.namespace,
        description: `${maxCount} errors/min detected (baseline: ${avg.toFixed(1)}/min). ${errorLines.length} total errors in window.`,
        evidence: {
          metric: "error_rate",
          currentValue: maxCount,
          baselineValue: avg,
          zScore: std > 0 ? (maxCount - avg) / std : undefined,
          threshold: Math.max(threshold, 10),
          sampleLogLines: sampleLines,
        },
      });
    }
  }

  return anomalies;
}

function detectEventFloods(events: K8sEvent[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Group warning events by object
  const objectEvents = new Map<string, K8sEvent[]>();
  for (const event of events) {
    if (event.type !== "Warning") continue;
    const key = `${event.involvedObject.kind}/${event.involvedObject.name}`;
    if (!objectEvents.has(key)) objectEvents.set(key, []);
    objectEvents.get(key)!.push(event);
  }

  for (const [objectKey, objEvents] of objectEvents) {
    const totalCount = objEvents.reduce((sum, e) => sum + e.count, 0);
    if (totalCount < 5) continue;

    // Escalate certain reasons
    const hasOOM = objEvents.some((e) => e.reason === "OOMKilling");
    const hasFailedScheduling = objEvents.some((e) => e.reason === "FailedScheduling");
    const hasEvicted = objEvents.some((e) => e.reason === "Evicted");

    let severity: Severity = "medium";
    if (hasOOM || totalCount > 20) severity = "critical";
    else if (hasFailedScheduling || hasEvicted || totalCount > 10) severity = "high";

    const service = extractServiceName(objectKey.split("/")[1] ?? objectKey);
    const reasons = [...new Set(objEvents.map((e) => e.reason))].join(", ");

    anomalies.push({
      type: "event_flood",
      severity,
      timestamp: objEvents[0].timestamp,
      service,
      pod: objectKey.includes("Pod/") ? objectKey.split("/")[1] : "",
      namespace: objEvents[0].namespace,
      description: `${totalCount} warning events for ${objectKey}. Reasons: ${reasons}`,
      evidence: {
        currentValue: totalCount,
        threshold: 5,
        eventReason: reasons,
        sampleLogLines: objEvents.slice(0, 3).map((e) => `[${e.reason}] ${e.message}`),
      },
    });
  }

  return anomalies;
}

// Stats helpers
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeZScore(value: number, population: number[]): number {
  const avg = mean(population);
  const std = stddev(population);
  if (std === 0) return 0;
  return (value - avg) / std;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}Ki`;
  return `${bytes}B`;
}

export { mean, stddev, computeZScore };
