import { Anomaly } from "../types/anomaly.js";
import { Correlation, TimelineEntry } from "../types/correlation.js";

interface CausalRule {
  causeType: string;
  effectType: string;
  maxDeltaSeconds: number;
  relationship: string;
  sameService: boolean; // true = must be same service, false = can be cross-service
}

const CAUSAL_RULES: CausalRule[] = [
  { causeType: "memory_spike", effectType: "oom_kill", maxDeltaSeconds: 300, relationship: "Memory exhaustion led to OOM kill", sameService: true },
  { causeType: "oom_kill", effectType: "restart_storm", maxDeltaSeconds: 60, relationship: "OOM kill triggered pod restarts", sameService: true },
  { causeType: "cpu_spike", effectType: "error_burst", maxDeltaSeconds: 300, relationship: "CPU saturation caused request failures/timeouts", sameService: true },
  { causeType: "restart_storm", effectType: "error_burst", maxDeltaSeconds: 120, relationship: "Pod restarts caused downstream connection failures", sameService: false },
  { causeType: "oom_kill", effectType: "error_burst", maxDeltaSeconds: 120, relationship: "OOM kill caused service unavailability and downstream errors", sameService: false },
  { causeType: "event_flood", effectType: "restart_storm", maxDeltaSeconds: 300, relationship: "Warning events indicate underlying issue causing restarts", sameService: true },
];

export function buildTimeline(anomalies: Anomaly[]): TimelineEntry[] {
  return anomalies
    .map((a) => ({
      timestamp: a.timestamp,
      event: a.description,
      service: a.service,
      pod: a.pod,
      severity: a.severity,
      type: a.type,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function findCorrelations(anomalies: Anomaly[]): Correlation[] {
  const correlations: Correlation[] = [];
  const sorted = [...anomalies].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      const deltaMs = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      const deltaSeconds = deltaMs / 1000;

      // Skip if too far apart
      if (deltaSeconds > 300) continue;

      // Check causal rules
      for (const rule of CAUSAL_RULES) {
        if (a.type !== rule.causeType || b.type !== rule.effectType) continue;
        if (deltaSeconds > rule.maxDeltaSeconds) continue;
        if (rule.sameService && a.service !== b.service) continue;

        const confidence = computeConfidence(deltaSeconds, rule.maxDeltaSeconds, true);

        correlations.push({
          eventA: `${a.type} on ${a.pod || a.service} (${a.timestamp})`,
          eventB: `${b.type} on ${b.pod || b.service} (${b.timestamp})`,
          serviceA: a.service,
          serviceB: b.service,
          timeDeltaSeconds: Math.round(deltaSeconds),
          confidence,
          relationship: rule.relationship,
        });
      }

      // Cross-service correlation: same anomaly type in different services within 1 min
      if (a.service !== b.service && a.type === b.type && deltaSeconds < 60) {
        const alreadyCorrelated = correlations.some(
          (c) => c.serviceA === a.service && c.serviceB === b.service
        );
        if (!alreadyCorrelated) {
          correlations.push({
            eventA: `${a.type} on ${a.service} (${a.timestamp})`,
            eventB: `${b.type} on ${b.service} (${b.timestamp})`,
            serviceA: a.service,
            serviceB: b.service,
            timeDeltaSeconds: Math.round(deltaSeconds),
            confidence: "medium",
            relationship: `Concurrent ${a.type} across services suggests shared root cause or cascading failure`,
          });
        }
      }
    }
  }

  // Deduplicate and keep highest confidence
  const unique = new Map<string, Correlation>();
  for (const c of correlations) {
    const key = `${c.serviceA}-${c.serviceB}-${c.eventA}-${c.eventB}`;
    const existing = unique.get(key);
    if (!existing || confidenceRank(c.confidence) > confidenceRank(existing.confidence)) {
      unique.set(key, c);
    }
  }

  return [...unique.values()].sort((a, b) =>
    confidenceRank(b.confidence) - confidenceRank(a.confidence) || a.timeDeltaSeconds - b.timeDeltaSeconds
  );
}

function computeConfidence(deltaSeconds: number, maxDelta: number, hasRule: boolean): "high" | "medium" | "low" {
  if (hasRule && deltaSeconds < 60) return "high";
  if (hasRule && deltaSeconds < maxDelta) return "medium";
  if (!hasRule && deltaSeconds < 60) return "medium";
  return "low";
}

function confidenceRank(c: "high" | "medium" | "low"): number {
  return { high: 3, medium: 2, low: 1 }[c];
}
