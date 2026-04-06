import { Severity } from "./unified-schema.js";

export interface Correlation {
  eventA: string;
  eventB: string;
  serviceA: string;
  serviceB: string;
  timeDeltaSeconds: number;
  confidence: "high" | "medium" | "low";
  relationship: string;
}

export interface TimelineEntry {
  timestamp: string;
  event: string;
  service: string;
  pod: string;
  severity: Severity;
  type: string;
}

export interface RootCause {
  hypothesis: string;
  confidence: "high" | "medium" | "low";
  supportingEvidence: string[];
}

export interface Bottleneck {
  resource: string;
  service: string;
  pod: string;
  description: string;
  evidence: string;
}

export interface Recommendation {
  priority: Severity;
  action: string;
  rationale: string;
}

export interface RCAResult {
  timeline: TimelineEntry[];
  correlations: Correlation[];
  rootCause: RootCause;
  bottlenecks: Bottleneck[];
  recommendations: Recommendation[];
}
