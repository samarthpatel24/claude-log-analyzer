import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getEvents } from "../k8s/events.js";

export function registerGetEvents(server: McpServer): void {
  server.tool(
    "get_events",
    "Fetch Kubernetes events (Warning/Normal) for a namespace or cluster-wide. Useful for spotting OOM kills, scheduling failures, and pod issues.",
    {
      namespace: z.string().optional().describe("Namespace (omit for cluster-wide)"),
      involvedObjectName: z.string().optional().describe("Filter by object name"),
      involvedObjectKind: z.string().optional().describe("Filter by object kind (Pod, Deployment, Node)"),
      eventType: z.enum(["Warning", "Normal", "all"]).optional().describe("Event type filter (default: all)"),
      sinceMinutes: z.number().optional().describe("Events from last N minutes (default: 60)"),
    },
    async (params) => {
      try {
        const events = await getEvents({
          namespace: params.namespace,
          involvedObjectName: params.involvedObjectName,
          involvedObjectKind: params.involvedObjectKind,
          eventType: params.eventType,
          sinceMinutes: params.sinceMinutes,
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              totalEvents: events.length,
              warningCount: events.filter((e) => e.type === "Warning").length,
              events,
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to get events: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
