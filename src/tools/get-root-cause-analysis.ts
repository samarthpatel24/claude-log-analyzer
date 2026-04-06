import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPodLogs } from "../k8s/logs.js";
import { getPodStatuses } from "../k8s/pods.js";
import { getResourceMetrics } from "../k8s/metrics.js";
import { getEvents } from "../k8s/events.js";
import { detectAnomalies } from "../analysis/anomaly-detector.js";
import { performRCA } from "../analysis/rca-engine.js";
import { exportReport } from "../report/generator.js";
import { ReportData } from "../report/formatter.js";
import { config } from "../config.js";
import { ClusterHealthSummary } from "../types/unified-schema.js";

export function registerGetRootCauseAnalysis(server: McpServer): void {
  server.tool(
    "get_root_cause_analysis",
    "Full root cause analysis: fetches all data, detects anomalies, correlates events, and exports an evidence-backed report. This is the main analysis tool.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      timeWindowMinutes: z.number().optional().describe("Time window in minutes (default: from config)"),
      mode: z.enum(["logs", "metrics", "both"]).optional().describe("Analysis mode (default: both)"),
      focusService: z.string().optional().describe("Optional service to focus on"),
      exportFormat: z.enum(["md", "txt"]).optional().describe("Report format: md or txt (default: md)"),
      exportPath: z.string().optional().describe("File path for exported report (default: ./k8s-rca-report.md)"),
    },
    async (params) => {
      try {
        const timeWindow = params.timeWindowMinutes ?? config.defaultTimeWindowMinutes;
        const mode = params.mode ?? config.defaultMode;
        const format = params.exportFormat ?? "md";
        const labelSelector = params.focusService ? `app=${params.focusService}` : undefined;

        // Step 1: Fetch all data
        const podStatuses = await getPodStatuses({
          namespace: params.namespace,
          labelSelector,
        });

        const events = await getEvents({
          namespace: params.namespace,
          sinceMinutes: timeWindow,
        });

        let logs = undefined;
        if (mode === "logs" || mode === "both") {
          logs = await fetchPodLogs({
            namespace: params.namespace,
            labelSelector,
            sinceSeconds: timeWindow * 60,
          });
        }

        let metrics = undefined;
        if (mode === "metrics" || mode === "both") {
          try {
            metrics = await getResourceMetrics({
              namespace: params.namespace,
              labelSelector,
            });
          } catch {
            // metrics-server might not be available
          }
        }

        // Step 2: Compute health summary
        let totalRestarts = 0;
        let crashLoopPods = 0;
        for (const pod of podStatuses) {
          for (const c of pod.containers) {
            totalRestarts += c.restartCount;
            if (c.stateDetail === "CrashLoopBackOff") crashLoopPods++;
          }
        }

        const healthSummary: ClusterHealthSummary = {
          totalPods: podStatuses.length,
          runningPods: podStatuses.filter((p) => p.phase === "Running").length,
          pendingPods: podStatuses.filter((p) => p.phase === "Pending").length,
          failedPods: podStatuses.filter((p) => p.phase === "Failed").length,
          crashLoopPods,
          totalRestarts,
          recentWarningEvents: events.filter((e) => e.type === "Warning").length,
        };

        // Step 3: Detect anomalies
        const anomalies = detectAnomalies({
          logs,
          podStatuses,
          metrics,
          events,
          timeWindowMinutes: timeWindow,
        });

        // Step 4: Perform RCA
        const rca = performRCA({ anomalies, metrics });

        // Step 5: Generate report
        const reportData: ReportData = {
          namespace: params.namespace,
          timeWindowMinutes: timeWindow,
          mode,
          generatedAt: new Date().toISOString(),
          healthSummary,
          anomalies,
          rca,
        };

        const filePath = exportReport(reportData, format, params.exportPath);

        // Return summary (keep token count low) + file path
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              reportExportedTo: filePath,
              summary: {
                namespace: params.namespace,
                timeWindow: `${timeWindow}m`,
                mode,
                totalAnomalies: anomalies.length,
                criticalCount: anomalies.filter((a) => a.severity === "critical").length,
                highCount: anomalies.filter((a) => a.severity === "high").length,
                rootCause: rca.rootCause.hypothesis,
                rootCauseConfidence: rca.rootCause.confidence,
                correlationsFound: rca.correlations.length,
                bottlenecks: rca.bottlenecks.length,
                recommendations: rca.recommendations.length,
                topRecommendations: rca.recommendations.slice(0, 3).map((r) => `[${r.priority.toUpperCase()}] ${r.action}`),
              },
              healthSummary,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `RCA failed: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
