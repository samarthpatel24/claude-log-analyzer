import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPodLogs, summarizeLogs } from "../k8s/logs.js";
import { getPodStatuses } from "../k8s/pods.js";
import { getResourceMetrics } from "../k8s/metrics.js";
import { getEvents } from "../k8s/events.js";
import { detectAnomalies } from "../analysis/anomaly-detector.js";
import { config } from "../config.js";
import { getAppsV1Api } from "../k8s/client.js";

export function registerAnalyzeService(server: McpServer): void {
  server.tool(
    "analyze_service",
    "Deep dive on a specific service. Combines pod status, logs, metrics, events, and anomaly detection into a single view.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      serviceName: z.string().describe("Service/deployment name (used as label app=<name>)"),
      timeWindowMinutes: z.number().optional().describe("Time window in minutes (default: from config)"),
      mode: z.enum(["logs", "metrics", "both"]).optional().describe("Analysis mode (default: both)"),
    },
    async (params) => {
      try {
        const timeWindow = params.timeWindowMinutes ?? config.defaultTimeWindowMinutes;
        const mode = params.mode ?? config.defaultMode;
        const labelSelector = `app=${params.serviceName}`;

        // Fetch pod statuses
        const podStatuses = await getPodStatuses({
          namespace: params.namespace,
          labelSelector,
        });

        // Get deployment info
        let replicasDesired = 0;
        let replicasAvailable = 0;
        try {
          const appsApi = getAppsV1Api();
          const deployment = await appsApi.readNamespacedDeployment({
            name: params.serviceName,
            namespace: params.namespace,
          });
          replicasDesired = deployment.spec?.replicas ?? 0;
          replicasAvailable = deployment.status?.availableReplicas ?? 0;
        } catch {
          // Might not be a deployment
        }

        // Get events
        const events = await getEvents({
          namespace: params.namespace,
          sinceMinutes: timeWindow,
        });
        const serviceEvents = events.filter((e) =>
          e.involvedObject.name.includes(params.serviceName)
        );

        // Get logs if mode includes logs
        let logs = undefined;
        let logSummary = undefined;
        if (mode === "logs" || mode === "both") {
          logs = await fetchPodLogs({
            namespace: params.namespace,
            labelSelector,
            sinceSeconds: timeWindow * 60,
          });
          logSummary = summarizeLogs(logs);
        }

        // Get metrics if mode includes metrics
        let metricsData = undefined;
        let metricsResult: any = undefined;
        if (mode === "metrics" || mode === "both") {
          try {
            metricsData = await getResourceMetrics({
              namespace: params.namespace,
              labelSelector,
            });

            // Compute averages
            const allCpu = metricsData.flatMap((p) => p.containers.map((c) => c.cpuUsagePercent).filter((v): v is number => v !== undefined));
            const allMem = metricsData.flatMap((p) => p.containers.map((c) => c.memoryUsagePercent).filter((v): v is number => v !== undefined));

            metricsResult = {
              avgCpuPercent: allCpu.length > 0 ? Math.round(allCpu.reduce((a, b) => a + b, 0) / allCpu.length) : null,
              maxCpuPercent: allCpu.length > 0 ? Math.max(...allCpu) : null,
              avgMemoryPercent: allMem.length > 0 ? Math.round(allMem.reduce((a, b) => a + b, 0) / allMem.length) : null,
              maxMemoryPercent: allMem.length > 0 ? Math.max(...allMem) : null,
            };
          } catch {
            // metrics-server not available
          }
        }

        // Run anomaly detection
        const anomalies = detectAnomalies({
          logs: logs,
          podStatuses,
          metrics: metricsData,
          events: serviceEvents,
          timeWindowMinutes: timeWindow,
        });

        // Determine health status
        const hasCritical = anomalies.some((a) => a.severity === "critical");
        const hasHigh = anomalies.some((a) => a.severity === "high");
        const healthStatus = hasCritical ? "critical" : hasHigh ? "degraded" : "healthy";

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              service: {
                name: params.serviceName,
                namespace: params.namespace,
                pods: podStatuses.map((p) => ({
                  name: p.name,
                  phase: p.phase,
                  restarts: p.containers.reduce((s, c) => s + c.restartCount, 0),
                  age: p.age,
                })),
                replicasDesired,
                replicasAvailable,
              },
              health: {
                status: healthStatus,
                issues: anomalies.map((a) => `[${a.severity.toUpperCase()}] ${a.description}`),
              },
              metrics: metricsResult,
              logSummary,
              recentEvents: serviceEvents.slice(0, 10).map((e) => ({
                timestamp: e.timestamp,
                reason: e.reason,
                message: e.message,
              })),
              anomalies,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Service analysis failed: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
