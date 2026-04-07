import { getCoreV1Api } from "./client.js";
import { PodStatus, ContainerStatus } from "../types/unified-schema.js";
import { computeAge } from "../utils.js";

export interface GetPodStatusOptions {
  namespace: string;
  podName?: string;
  labelSelector?: string;
}

function extractContainerStatus(cs: any): ContainerStatus {
  let state: ContainerStatus["state"] = "waiting";
  let stateDetail = "";
  let lastTerminationReason: string | undefined;
  let lastTerminationExitCode: number | undefined;

  if (cs.state?.running) {
    state = "running";
    stateDetail = "running";
  } else if (cs.state?.waiting) {
    state = "waiting";
    stateDetail = cs.state.waiting.reason ?? "waiting";
  } else if (cs.state?.terminated) {
    state = "terminated";
    stateDetail = cs.state.terminated.reason ?? "terminated";
  }

  if (cs.lastState?.terminated) {
    lastTerminationReason = cs.lastState.terminated.reason;
    lastTerminationExitCode = cs.lastState.terminated.exitCode;
  }

  return {
    name: cs.name ?? "unknown",
    ready: cs.ready ?? false,
    restartCount: cs.restartCount ?? 0,
    state,
    stateDetail,
    lastTerminationReason,
    lastTerminationExitCode,
  };
}

export async function getPodStatuses(opts: GetPodStatusOptions): Promise<PodStatus[]> {
  const api = getCoreV1Api();

  if (opts.podName) {
    const pod = await api.readNamespacedPod({ name: opts.podName, namespace: opts.namespace });
    return [mapPodToStatus(pod, opts.namespace)];
  }

  const pods = await api.listNamespacedPod({
    namespace: opts.namespace,
    labelSelector: opts.labelSelector,
  });

  return (pods.items ?? []).map((p) => mapPodToStatus(p, opts.namespace));
}

function mapPodToStatus(pod: any, namespace: string): PodStatus {
  const containerStatuses = pod.status?.containerStatuses ?? [];

  return {
    name: pod.metadata?.name ?? "unknown",
    namespace,
    phase: pod.status?.phase ?? "Unknown",
    conditions: (pod.status?.conditions ?? []).map((c: any) => ({
      type: c.type ?? "",
      status: c.status ?? "",
      reason: c.reason,
      message: c.message,
      lastTransitionTime: c.lastTransitionTime?.toISOString?.() ?? c.lastTransitionTime ?? "",
    })),
    containers: containerStatuses.map(extractContainerStatus),
    nodeName: pod.spec?.nodeName ?? "unknown",
    startTime: pod.status?.startTime?.toISOString?.() ?? pod.status?.startTime ?? "",
    age: computeAge(pod.status?.startTime ? new Date(pod.status.startTime) : undefined),
  };
}
