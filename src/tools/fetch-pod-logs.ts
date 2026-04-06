import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchPodLogs, summarizeLogs } from "../k8s/logs.js";
import { config } from "../config.js";

export function registerFetchPodLogs(server: McpServer): void {
  server.tool(
    "fetch_pod_logs",
    "Fetch and filter pod logs. Intelligently filters noise (health checks, probes) and extracts severity. Returns summarized results to minimize token usage.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      podName: z.string().optional().describe("Specific pod name"),
      labelSelector: z.string().optional().describe("Label selector (e.g. app=nginx)"),
      containerName: z.string().optional().describe("Specific container name"),
      sinceSeconds: z.number().optional().describe("Fetch logs from last N seconds"),
      tailLines: z.number().optional().describe("Max log lines per pod"),
      grepPattern: z.string().optional().describe("Regex pattern to filter log lines"),
      severityFilter: z.enum(["error", "warn", "info", "all"]).optional().describe("Filter by log severity level (default: all)"),
    },
    async (params) => {
      try {
        const results = await fetchPodLogs({
          namespace: params.namespace,
          podName: params.podName,
          labelSelector: params.labelSelector,
          containerName: params.containerName,
          sinceSeconds: params.sinceSeconds,
          tailLines: params.tailLines,
          grepPattern: params.grepPattern,
          severityFilter: params.severityFilter,
        });

        const summary = summarizeLogs(results);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ summary, pods: results }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to fetch logs: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
