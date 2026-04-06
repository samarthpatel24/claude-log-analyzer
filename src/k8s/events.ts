import { getCoreV1Api } from "./client.js";
import { K8sEvent } from "../types/unified-schema.js";

export interface GetEventsOptions {
  namespace?: string;
  involvedObjectName?: string;
  involvedObjectKind?: string;
  eventType?: "Warning" | "Normal" | "all";
  sinceMinutes?: number;
}

export async function getEvents(opts: GetEventsOptions): Promise<K8sEvent[]> {
  const api = getCoreV1Api();
  const sinceMinutes = opts.sinceMinutes ?? 60;
  const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);

  let items: any[];

  if (opts.namespace) {
    const response = await api.listNamespacedEvent({ namespace: opts.namespace });
    items = response.items ?? [];
  } else {
    const response = await api.listEventForAllNamespaces();
    items = response.items ?? [];
  }

  let events: K8sEvent[] = items.map((e: any) => ({
    timestamp: e.lastTimestamp?.toISOString?.() ?? e.eventTime?.toISOString?.() ?? e.metadata?.creationTimestamp?.toISOString?.() ?? "",
    namespace: e.metadata?.namespace ?? "",
    involvedObject: {
      kind: e.involvedObject?.kind ?? "",
      name: e.involvedObject?.name ?? "",
    },
    type: e.type ?? "Normal",
    reason: e.reason ?? "",
    message: e.message ?? "",
    count: e.count ?? 1,
    source: e.source?.component ?? "",
  }));

  // Filter by time
  events = events.filter((e) => {
    if (!e.timestamp) return true;
    return new Date(e.timestamp) >= cutoff;
  });

  // Filter by type
  if (opts.eventType && opts.eventType !== "all") {
    events = events.filter((e) => e.type === opts.eventType);
  }

  // Filter by involved object
  if (opts.involvedObjectName) {
    events = events.filter((e) => e.involvedObject.name.includes(opts.involvedObjectName!));
  }
  if (opts.involvedObjectKind) {
    events = events.filter((e) => e.involvedObject.kind === opts.involvedObjectKind);
  }

  // Sort by timestamp desc
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events;
}
