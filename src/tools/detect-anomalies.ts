import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectAnomalies } from "../analysis/anomaly-detector.js";
import { fetchPodLogs } from "../k8s/logs.js";
import { getPodStatuses } from "../k8s/pods.js";
import { getResourceMetrics } from "../k8s/metrics.js";
import { getEvents } from "../k8s/events.js";
import { config } from "../config.js";

export function registerDetectAnomalies(server: McpServer): void {
  server.tool(
    "detect_anomalies",
    "Run anomaly detection on a namespace. Detects CPU/memory spikes, error bursts, restart storms, OOM kills, event floods. Returns evidence-backed findings.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      labelSelector: z.string().optional().describe("Label selector to filter pods"),
      timeWindowMinutes: z.number().optional().describe("Time window in minutes (default: from config)"),
      mode: z.enum(["logs", "metrics", "both"]).optional().describe("Analysis mode: logs, metrics, or both (default: both)"),
    },
    async (params) => {
      try {
        const timeWindow = params.timeWindowMinutes ?? config.defaultTimeWindowMinutes;
        const mode = params.mode ?? config.defaultMode;

        const podStatuses = await getPodStatuses({
          namespace: params.namespace,
          labelSelector: params.labelSelector,
        });

        const events = await getEvents({
          namespace: params.namespace,
          sinceMinutes: timeWindow,
        });

        let logs = undefined;
        if (mode === "logs" || mode === "both") {
          logs = await fetchPodLogs({
            namespace: params.namespace,
            labelSelector: params.labelSelector,
            sinceSeconds: timeWindow * 60,
            severityFilter: "error",
          });
        }

        let metrics = undefined;
        if (mode === "metrics" || mode === "both") {
          try {
            metrics = await getResourceMetrics({
              namespace: params.namespace,
              labelSelector: params.labelSelector,
            });
          } catch {
            // metrics-server might not be available
          }
        }

        const anomalies = detectAnomalies({
          logs,
          podStatuses,
          metrics,
          events,
          timeWindowMinutes: timeWindow,
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              totalAnomalies: anomalies.length,
              bySeverity: {
                critical: anomalies.filter((a) => a.severity === "critical").length,
                high: anomalies.filter((a) => a.severity === "high").length,
                medium: anomalies.filter((a) => a.severity === "medium").length,
                low: anomalies.filter((a) => a.severity === "low").length,
              },
              anomalies,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Anomaly detection failed: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
