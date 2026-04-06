import { getCoreV1Api } from "./client.js";

export interface NamespaceInfo {
  name: string;
  status: string;
  labels: Record<string, string>;
  createdAt: string;
}

export async function listNamespaces(): Promise<NamespaceInfo[]> {
  const api = getCoreV1Api();
  const response = await api.listNamespace();
  const items = response.items ?? [];

  return items.map((ns) => ({
    name: ns.metadata?.name ?? "unknown",
    status: ns.status?.phase ?? "unknown",
    labels: ns.metadata?.labels ?? {},
    createdAt: ns.metadata?.creationTimestamp?.toISOString() ?? "unknown",
  }));
}
