export type Severity = "critical" | "high" | "medium" | "low";
export type LogSeverity = "error" | "warn" | "info" | "debug" | "unknown";
export type AnalysisMode = "logs" | "metrics" | "both";

export interface UnifiedRecord {
  timestamp: string;
  service: string;
  pod: string;
  namespace: string;
  source: "log" | "event" | "metric" | "status";
  severity: LogSeverity;
  message: string;
  metricValues?: Record<string, number>;
}

export interface PodLogEntry {
  timestamp: string;
  message: string;
  severity: LogSeverity;
}

export interface PodLogResult {
  podName: string;
  namespace: string;
  containerName: string;
  logs: PodLogEntry[];
  totalLines: number;
  truncated: boolean;
}

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: "running" | "waiting" | "terminated";
  stateDetail: string;
  lastTerminationReason?: string;
  lastTerminationExitCode?: number;
}

export interface PodStatus {
  name: string;
  namespace: string;
  phase: string;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
    lastTransitionTime: string;
  }>;
  containers: ContainerStatus[];
  nodeName: string;
  startTime: string;
  age: string;
}

export interface ContainerMetrics {
  name: string;
  cpuUsageMillicores: number;
  cpuRequestMillicores?: number;
  cpuLimitMillicores?: number;
  cpuUsagePercent?: number;
  memoryUsageBytes: number;
  memoryRequestBytes?: number;
  memoryLimitBytes?: number;
  memoryUsagePercent?: number;
}

export interface PodMetrics {
  name: string;
  namespace: string;
  containers: ContainerMetrics[];
  totalCpuMillicores: number;
  totalMemoryBytes: number;
}

export interface K8sEvent {
  timestamp: string;
  namespace: string;
  involvedObject: { kind: string; name: string };
  type: string;
  reason: string;
  message: string;
  count: number;
  source: string;
}

export interface ClusterHealthSummary {
  totalPods: number;
  runningPods: number;
  pendingPods: number;
  failedPods: number;
  crashLoopPods: number;
  totalRestarts: number;
  recentWarningEvents: number;
}

export interface ProblemPod {
  name: string;
  namespace: string;
  issue: string;
  restartCount: number;
  age: string;
}
