import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCoreV1Api } from "../k8s/client.js";
import { getEvents } from "../k8s/events.js";
import { ClusterHealthSummary, ProblemPod } from "../types/unified-schema.js";

function computeAge(startTime: Date | undefined): string {
  if (!startTime) return "unknown";
  const diffMs = Date.now() - startTime.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h${diffMin % 60}m`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d${diffHr % 24}h`;
}

export function registerGetClusterHealth(server: McpServer): void {
  server.tool(
    "get_cluster_health",
    "Get a high-level cluster health overview: pod counts, problem pods, recent warnings. Good starting point for investigation.",
    {
      namespace: z.string().optional().describe("Scope to namespace (omit for all)"),
    },
    async (params) => {
      try {
        const api = getCoreV1Api();

        const podsResponse = params.namespace
          ? await api.listNamespacedPod({ namespace: params.namespace })
          : await api.listPodForAllNamespaces();

        const items = podsResponse.items ?? [];
        let totalRestarts = 0;
        let crashLoopPods = 0;
        const problemPods: ProblemPod[] = [];

        const runningPods = items.filter((p) => p.status?.phase === "Running").length;
        const pendingPods = items.filter((p) => p.status?.phase === "Pending").length;
        const failedPods = items.filter((p) => p.status?.phase === "Failed").length;

        for (const pod of items) {
          const containers = pod.status?.containerStatuses ?? [];
          let podRestarts = 0;
          let isCrashLoop = false;
          let issue = "";

          for (const cs of containers) {
            podRestarts += cs.restartCount ?? 0;
            if (cs.state?.waiting?.reason === "CrashLoopBackOff") {
              isCrashLoop = true;
              issue = "CrashLoopBackOff";
            } else if (cs.lastState?.terminated?.reason === "OOMKilled") {
              issue = issue || "OOMKilled";
            } else if (cs.state?.waiting) {
              issue = issue || (cs.state.waiting.reason ?? "Waiting");
            }
          }

          totalRestarts += podRestarts;
          if (isCrashLoop) crashLoopPods++;

          if (pod.status?.phase !== "Running" || isCrashLoop || podRestarts > 3 || issue) {
            if (!issue) issue = pod.status?.phase ?? "Unknown";
            problemPods.push({
              name: pod.metadata?.name ?? "unknown",
              namespace: pod.metadata?.namespace ?? "unknown",
              issue,
              restartCount: podRestarts,
              age: computeAge(pod.status?.startTime ? new Date(pod.status.startTime) : undefined),
            });
          }
        }

        // Get recent warnings
        const events = await getEvents({
          namespace: params.namespace,
          eventType: "Warning",
          sinceMinutes: 30,
        });

        const recentWarnings = events.slice(0, 10).map((e) => ({
          timestamp: e.timestamp,
          object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
          reason: e.reason,
          message: e.message,
        }));

        // Namespace breakdown
        const nsMap = new Map<string, { healthy: number; unhealthy: number }>();
        for (const pod of items) {
          const ns = pod.metadata?.namespace ?? "unknown";
          if (!nsMap.has(ns)) nsMap.set(ns, { healthy: 0, unhealthy: 0 });
          const entry = nsMap.get(ns)!;
          const isHealthy = pod.status?.phase === "Running" &&
            (pod.status?.containerStatuses ?? []).every((cs: any) => cs.ready);
          if (isHealthy) entry.healthy++;
          else entry.unhealthy++;
        }

        const summary: ClusterHealthSummary = {
          totalPods: items.length,
          runningPods,
          pendingPods,
          failedPods,
          crashLoopPods,
          totalRestarts,
          recentWarningEvents: events.length,
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              summary,
              problemPods: problemPods.slice(0, 20),
              recentWarnings,
              namespaceBreakdown: [...nsMap.entries()].map(([ns, counts]) => ({ namespace: ns, ...counts })),
            }, null, 2),
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Failed to get cluster health: ${message}` }) }],
          isError: true,
        };
      }
    }
  );
}
