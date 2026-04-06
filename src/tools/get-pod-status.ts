import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPodStatuses } from "../k8s/pods.js";

export function registerGetPodStatus(server: McpServer): void {
  server.tool(
    "get_pod_status",
    "Get detailed pod status including phase, conditions, container states, restart counts, and termination reasons.",
    {
      namespace: z.string().describe("Kubernetes namespace"),
      podName: z.string().optional().describe("Specific pod name"),
      labelSelector: z.string().optional().describe("Label selector (e.g. app=nginx)"),
    },
    async (params) => {
      try {
        const pods = await getPodStatuses({
          namespace: params.namespace,
          podName: params.podName,
          labelSelector: params.labelSelector,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ pods }, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to get pod status: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
