import { Anomaly } from "../types/anomaly.js";
import { Correlation, RootCause, Bottleneck, Recommendation, RCAResult } from "../types/correlation.js";
import { PodMetrics } from "../types/unified-schema.js";
import { buildTimeline, findCorrelations } from "./correlation-engine.js";

interface RCAInput {
  anomalies: Anomaly[];
  metrics?: PodMetrics[];
}

export function performRCA(input: RCAInput): RCAResult {
  const { anomalies } = input;
  const timeline = buildTimeline(anomalies);
  const correlations = findCorrelations(anomalies);
  const rootCause = identifyRootCause(anomalies, correlations);
  const bottlenecks = identifyBottlenecks(anomalies, input.metrics);
  const recommendations = generateRecommendations(anomalies, bottlenecks, correlations);

  return { timeline, correlations, rootCause, bottlenecks, recommendations };
}

function identifyRootCause(anomalies: Anomaly[], correlations: Correlation[]): RootCause {
  if (anomalies.length === 0) {
    return {
      hypothesis: "No anomalies detected in the given time window.",
      confidence: "low",
      supportingEvidence: ["No anomalies found"],
    };
  }

  // Build a directed graph of causes
  // A service that appears as serviceA (cause) in correlations but never as serviceB (effect) is a root candidate
  const causeCount = new Map<string, number>();
  const effectCount = new Map<string, number>();

  for (const c of correlations) {
    causeCount.set(c.serviceA, (causeCount.get(c.serviceA) ?? 0) + 1);
    effectCount.set(c.serviceB, (effectCount.get(c.serviceB) ?? 0) + 1);
  }

  // Root candidates: services that are causes but not effects, or have more cause than effect edges
  const services = new Set([...causeCount.keys(), ...effectCount.keys()]);
  let rootService = "";
  let maxScore = -1;

  for (const svc of services) {
    const causes = causeCount.get(svc) ?? 0;
    const effects = effectCount.get(svc) ?? 0;
    const score = causes - effects;
    if (score > maxScore) {
      maxScore = score;
      rootService = svc;
    }
  }

  // If no correlations, use the earliest critical anomaly
  if (!rootService && anomalies.length > 0) {
    const critical = anomalies.filter((a) => a.severity === "critical");
    const earliest = (critical.length > 0 ? critical : anomalies)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0];
    rootService = earliest.service;
  }

  // Build hypothesis from root service anomalies
  const rootAnomalies = anomalies.filter((a) => a.service === rootService);
  const rootTypes = [...new Set(rootAnomalies.map((a) => a.type))];

  let hypothesis = "";
  if (rootTypes.includes("oom_kill")) {
    hypothesis = `Memory exhaustion in '${rootService}' caused OOM kills, leading to pod restarts and potential downstream failures.`;
  } else if (rootTypes.includes("cpu_spike")) {
    hypothesis = `CPU saturation in '${rootService}' caused request timeouts and error cascades.`;
  } else if (rootTypes.includes("restart_storm")) {
    hypothesis = `Repeated pod restarts in '${rootService}' caused service instability and downstream errors.`;
  } else if (rootTypes.includes("error_burst")) {
    hypothesis = `Error burst in '${rootService}' indicates application-level failures requiring investigation.`;
  } else {
    hypothesis = `Issues detected in '${rootService}': ${rootTypes.join(", ")}.`;
  }

  // Add cascade info
  const downstreamServices = correlations
    .filter((c) => c.serviceA === rootService && c.serviceB !== rootService)
    .map((c) => c.serviceB);
  if (downstreamServices.length > 0) {
    hypothesis += ` Downstream impact observed in: ${[...new Set(downstreamServices)].join(", ")}.`;
  }

  const supportingEvidence = rootAnomalies.map((a) => {
    let evidence = a.description;
    if (a.evidence.sampleLogLines?.length) {
      evidence += ` | Log sample: "${a.evidence.sampleLogLines[0]}"`;
    }
    if (a.evidence.currentValue !== undefined && a.evidence.threshold !== undefined) {
      evidence += ` | Value: ${a.evidence.currentValue}, Threshold: ${a.evidence.threshold}`;
    }
    return evidence;
  });

  const highConfidenceCorrelations = correlations.filter((c) => c.confidence === "high");
  const confidence: "high" | "medium" | "low" =
    highConfidenceCorrelations.length > 0 ? "high" :
    correlations.length > 0 ? "medium" : "low";

  return { hypothesis, confidence, supportingEvidence };
}

function identifyBottlenecks(anomalies: Anomaly[], metrics?: PodMetrics[]): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];

  // From anomalies
  for (const a of anomalies) {
    if (a.type === "cpu_spike" && a.evidence.currentValue !== undefined) {
      bottlenecks.push({
        resource: "CPU",
        service: a.service,
        pod: a.pod,
        description: `CPU at ${a.evidence.currentValue}m${a.evidence.threshold ? ` of ${a.evidence.threshold}m limit` : ""}`,
        evidence: a.description,
      });
    }
    if ((a.type === "memory_spike" || a.type === "oom_kill") && a.evidence.currentValue !== undefined) {
      bottlenecks.push({
        resource: "Memory",
        service: a.service,
        pod: a.pod,
        description: a.description,
        evidence: a.type === "oom_kill" ? `OOM killed - memory limit reached` : a.description,
      });
    }
  }

  return bottlenecks;
}

function generateRecommendations(anomalies: Anomaly[], bottlenecks: Bottleneck[], correlations: Correlation[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const seen = new Set<string>();

  for (const a of anomalies) {
    let rec: { priority: Recommendation["priority"]; action: string; rationale: string } | null = null;

    switch (a.type) {
      case "oom_kill":
        rec = {
          priority: "critical",
          action: `Increase memory limit for '${a.service}' deployment`,
          rationale: `Container was OOM killed. Current limit is insufficient for workload. ${a.description}`,
        };
        break;
      case "cpu_spike":
        if (a.severity === "critical" || a.severity === "high") {
          rec = {
            priority: "high",
            action: `Increase CPU limit or add HPA for '${a.service}'`,
            rationale: `${a.description}. Consider horizontal scaling if load is variable.`,
          };
        }
        break;
      case "memory_spike":
        if (a.severity === "critical" || a.severity === "high") {
          rec = {
            priority: "high",
            action: `Increase memory limit for '${a.service}' or investigate memory leak`,
            rationale: a.description,
          };
        }
        break;
      case "restart_storm":
        rec = {
          priority: a.severity === "critical" ? "critical" : "high",
          action: `Investigate root cause of restarts in '${a.service}' (check logs for crash reason)`,
          rationale: a.description,
        };
        break;
      case "error_burst":
        rec = {
          priority: a.severity === "critical" ? "critical" : "high",
          action: `Investigate error spike in '${a.service}' application logs`,
          rationale: a.description,
        };
        break;
    }

    if (rec && !seen.has(rec.action)) {
      seen.add(rec.action);
      recommendations.push(rec);
    }
  }

  // Cross-service cascade recommendations
  const cascades = correlations.filter((c) => c.serviceA !== c.serviceB);
  if (cascades.length > 0) {
    const services = [...new Set(cascades.map((c) => c.serviceB))];
    const rec = {
      priority: "high" as const,
      action: `Add circuit breakers/retry policies for dependencies: ${services.join(", ")}`,
      rationale: `Cascading failures detected across services. Circuit breakers would limit blast radius.`,
    };
    if (!seen.has(rec.action)) {
      recommendations.push(rec);
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
