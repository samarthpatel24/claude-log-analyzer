import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getResourceMetrics } from "../k8s/metrics.js";

export function registerGetResourceMetrics(server: McpServer): void {
  server.tool(
    "get_resource_metrics",
    "Fetch CPU and memory usage via Kubernetes Metrics API. Returns usage with percentage against limits/requests. Requires metrics-server.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      podName: z.string().optional().describe("Specific pod name"),
      labelSelector: z.string().optional().describe("Label selector (e.g. app=nginx)"),
    },
    async (params) => {
      try {
        const metrics = await getResourceMetrics({
          namespace: params.namespace,
          podName: params.podName,
          labelSelector: params.labelSelector,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ metrics }, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }
  );
}
