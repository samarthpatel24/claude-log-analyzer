import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListNamespaces } from "./tools/list-namespaces.js";
import { registerFetchPodLogs } from "./tools/fetch-pod-logs.js";
import { registerGetPodStatus } from "./tools/get-pod-status.js";
import { registerGetResourceMetrics } from "./tools/get-resource-metrics.js";
import { registerGetEvents } from "./tools/get-events.js";
import { registerGetClusterHealth } from "./tools/get-cluster-health.js";
import { registerDetectAnomalies } from "./tools/detect-anomalies.js";
import { registerAnalyzeService } from "./tools/analyze-service.js";
import { registerGetRootCauseAnalysis } from "./tools/get-root-cause-analysis.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "claude-log-analyzer",
    version: "1.0.0",
  });

  registerListNamespaces(server);
  registerFetchPodLogs(server);
  registerGetPodStatus(server);
  registerGetResourceMetrics(server);
  registerGetEvents(server);
  registerGetClusterHealth(server);
  registerDetectAnomalies(server);
  registerAnalyzeService(server);
  registerGetRootCauseAnalysis(server);

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
