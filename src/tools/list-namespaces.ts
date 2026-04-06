import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listNamespaces } from "../k8s/namespaces.js";

export function registerListNamespaces(server: McpServer): void {
  server.tool(
    "list_namespaces",
    "List all Kubernetes namespaces in the cluster. Use this first to discover available namespaces.",
    {},
    async () => {
      try {
        const namespaces = await listNamespaces();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ namespaces }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `Failed to list namespaces: ${message}` }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
