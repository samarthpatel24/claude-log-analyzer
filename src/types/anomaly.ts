import { Severity } from "./unified-schema.js";

export type AnomalyType =
  | "cpu_spike"
  | "memory_spike"
  | "error_burst"
  | "restart_storm"
  | "event_flood"
  | "oom_kill";

export interface AnomalyEvidence {
  metric?: string;
  currentValue?: number;
  baselineValue?: number;
  zScore?: number;
  threshold?: number;
  sampleLogLines?: string[];
  eventReason?: string;
}

export interface Anomaly {
  type: AnomalyType;
  severity: Severity;
  timestamp: string;
  service: string;
  pod: string;
  namespace: string;
  description: string;
  evidence: AnomalyEvidence;
}
