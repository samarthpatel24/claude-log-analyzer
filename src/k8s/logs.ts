import { getCoreV1Api } from "./client.js";
import { config } from "../config.js";
import { PodLogEntry, PodLogResult, LogSeverity } from "../types/unified-schema.js";
import { safeRegex } from "../utils.js";

const ERROR_KEYWORDS = [
  "error", "err", "fatal", "panic", "exception", "fail", "critical",
  "crash", "oom", "killed", "timeout", "refused", "unavailable",
  "backoff", "crashloopbackoff", "oomkilled",
];

const WARN_KEYWORDS = [
  "warn", "warning", "deprecated", "retry", "slow", "degraded",
];

const NOISE_PATTERNS = [
  /^$/,
  /^\s+at\s+/,
  /^---$/,
  /^\.+$/,
  /healthcheck/i,
  /readiness.*probe/i,
  /liveness.*probe/i,
];

export function detectSeverity(line: string): LogSeverity {
  const lower = line.toLowerCase();
  if (/\b(fatal|panic)\b/.test(lower)) return "error";
  if (/\berr(or)?\b/.test(lower) || /\bexception\b/.test(lower)) return "error";
  if (/\bwarn(ing)?\b/.test(lower)) return "warn";
  if (/\bdebug\b/.test(lower)) return "debug";
  if (/\binfo\b/.test(lower)) return "info";
  return "unknown";
}

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(line));
}

function parseTimestamp(line: string): { timestamp: string; message: string } {
  // ISO 8601 timestamp at start
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)/);
  if (isoMatch) return { timestamp: isoMatch[1], message: isoMatch[2] };

  // RFC3339 with space
  const rfcMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+[\d:.]+)\s+(.*)/);
  if (rfcMatch) return { timestamp: rfcMatch[1], message: rfcMatch[2] };

  return { timestamp: new Date().toISOString(), message: line };
}

export interface FetchLogsOptions {
  namespace: string;
  podName?: string;
  labelSelector?: string;
  containerName?: string;
  sinceSeconds?: number;
  tailLines?: number;
  grepPattern?: string;
  severityFilter?: "error" | "warn" | "info" | "all";
}

export async function fetchPodLogs(opts: FetchLogsOptions): Promise<PodLogResult[]> {
  const api = getCoreV1Api();
  const maxLines = opts.tailLines ?? config.logMaxLines;
  const sinceSeconds = opts.sinceSeconds ?? config.defaultTimeWindowMinutes * 60;

  // Get pods to fetch logs from
  let podNames: Array<{ name: string; containers: string[] }> = [];

  if (opts.podName) {
    const pod = await api.readNamespacedPod({ name: opts.podName, namespace: opts.namespace });
    podNames = [{
      name: pod.metadata?.name ?? opts.podName,
      containers: pod.spec?.containers?.map((c) => c.name) ?? [],
    }];
  } else {
    const pods = await api.listNamespacedPod({
      namespace: opts.namespace,
      labelSelector: opts.labelSelector,
    });
    podNames = (pods.items ?? []).map((p) => ({
      name: p.metadata?.name ?? "",
      containers: p.spec?.containers?.map((c) => c.name) ?? [],
    }));
  }

  const results: PodLogResult[] = [];
  const grepRegex = opts.grepPattern ? safeRegex(opts.grepPattern) : null;

  for (const pod of podNames) {
    const targetContainers = opts.containerName
      ? [opts.containerName]
      : pod.containers;

    for (const container of targetContainers) {
      try {
        const logResponse = await api.readNamespacedPodLog({
          name: pod.name,
          namespace: opts.namespace,
          container,
          sinceSeconds,
          tailLines: maxLines * 2, // fetch extra, we'll filter down
          timestamps: true,
        });

        const rawLines = (logResponse as string).split("\n").filter((l: string) => l.trim());
        const entries: PodLogEntry[] = [];
        let totalLines = rawLines.length;

        for (const line of rawLines) {
          // Skip noise (health checks, probes)
          if (isNoiseLine(line)) continue;

          const { timestamp, message } = parseTimestamp(line);
          const severity = detectSeverity(message);

          // Severity filter
          if (opts.severityFilter && opts.severityFilter !== "all") {
            if (opts.severityFilter === "error" && severity !== "error") continue;
            if (opts.severityFilter === "warn" && severity !== "error" && severity !== "warn") continue;
            if (opts.severityFilter === "info" && severity === "debug") continue;
          }

          // Grep filter
          if (grepRegex && !grepRegex.test(message)) continue;

          entries.push({ timestamp, message, severity });

          if (entries.length >= maxLines) break;
        }

        results.push({
          podName: pod.name,
          namespace: opts.namespace,
          containerName: container,
          logs: entries,
          totalLines,
          truncated: entries.length >= maxLines,
        });
      } catch {
        // Pod might not have this container or logs may be unavailable
        results.push({
          podName: pod.name,
          namespace: opts.namespace,
          containerName: container,
          logs: [],
          totalLines: 0,
          truncated: false,
        });
      }
    }
  }

  return results;
}

export function summarizeLogs(results: PodLogResult[]): {
  totalPods: number;
  totalLines: number;
  errorCount: number;
  warnCount: number;
  topErrors: string[];
} {
  let totalLines = 0;
  let errorCount = 0;
  let warnCount = 0;
  const errorMessages: Map<string, number> = new Map();

  for (const result of results) {
    totalLines += result.logs.length;
    for (const entry of result.logs) {
      if (entry.severity === "error") {
        errorCount++;
        // Deduplicate error messages by first 100 chars
        const key = entry.message.slice(0, 100);
        errorMessages.set(key, (errorMessages.get(key) ?? 0) + 1);
      }
      if (entry.severity === "warn") warnCount++;
    }
  }

  const topErrors = [...errorMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => `(${count}x) ${msg}`);

  return { totalPods: results.length, totalLines, errorCount, warnCount, topErrors };
}

export { ERROR_KEYWORDS, WARN_KEYWORDS };
