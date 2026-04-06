import { RCAResult, TimelineEntry, Correlation, Bottleneck, Recommendation } from "../types/correlation.js";
import { Anomaly } from "../types/anomaly.js";
import { ClusterHealthSummary } from "../types/unified-schema.js";

export interface ReportData {
  namespace: string;
  timeWindowMinutes: number;
  mode: string;
  generatedAt: string;
  healthSummary?: ClusterHealthSummary;
  anomalies: Anomaly[];
  rca: RCAResult;
}

export function formatMarkdown(data: ReportData): string {
  const lines: string[] = [];

  lines.push("# Kubernetes Root Cause Analysis Report");
  lines.push(`**Generated:** ${data.generatedAt}`);
  lines.push(`**Namespace:** ${data.namespace}`);
  lines.push(`**Time Window:** ${data.timeWindowMinutes} minutes`);
  lines.push(`**Mode:** ${data.mode}`);
  lines.push("");

  // Health snapshot
  if (data.healthSummary) {
    const h = data.healthSummary;
    lines.push("## Cluster Health Snapshot");
    lines.push(`- Total pods: ${h.totalPods} | Running: ${h.runningPods} | Pending: ${h.pendingPods} | Failed: ${h.failedPods} | CrashLoop: ${h.crashLoopPods}`);
    lines.push(`- Total restarts: ${h.totalRestarts}`);
    lines.push(`- Warning events (last ${data.timeWindowMinutes}m): ${h.recentWarningEvents}`);
    lines.push("");
  }

  // Anomalies
  if (data.anomalies.length > 0) {
    lines.push("## Anomalies Detected");
    lines.push("");
    for (const a of data.anomalies) {
      lines.push(`### [${a.severity.toUpperCase()}] ${formatAnomalyType(a.type)} — ${a.pod || a.service}`);
      lines.push(`- **Description:** ${a.description}`);
      if (a.evidence.currentValue !== undefined && a.evidence.threshold !== undefined) {
        lines.push(`- **Value:** ${a.evidence.currentValue} (threshold: ${a.evidence.threshold})`);
      }
      if (a.evidence.baselineValue !== undefined) {
        lines.push(`- **Baseline:** ${a.evidence.baselineValue.toFixed(1)}`);
      }
      if (a.evidence.zScore !== undefined) {
        lines.push(`- **Z-Score:** ${a.evidence.zScore.toFixed(2)}`);
      }
      if (a.evidence.sampleLogLines?.length) {
        lines.push("- **Sample log lines:**");
        for (const line of a.evidence.sampleLogLines) {
          lines.push(`  - \`${line}\``);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("## Anomalies Detected");
    lines.push("No anomalies detected in the given time window.");
    lines.push("");
  }

  // Timeline
  if (data.rca.timeline.length > 0) {
    lines.push("## Correlation Timeline");
    lines.push("| Time | Event | Service | Severity |");
    lines.push("|------|-------|---------|----------|");
    for (const t of data.rca.timeline) {
      lines.push(`| ${t.timestamp} | ${truncate(t.event, 60)} | ${t.service} | ${t.severity} |`);
    }
    lines.push("");
  }

  // Correlations
  if (data.rca.correlations.length > 0) {
    lines.push("## Correlations");
    for (const c of data.rca.correlations) {
      lines.push(`- ${c.eventA} → ${c.eventB} [delta: ${c.timeDeltaSeconds}s, confidence: ${c.confidence.toUpperCase()}]`);
      lines.push(`  - ${c.relationship}`);
    }
    lines.push("");
  }

  // Root cause
  lines.push("## Root Cause");
  lines.push(`**Hypothesis:** ${data.rca.rootCause.hypothesis}`);
  lines.push(`**Confidence:** ${data.rca.rootCause.confidence.toUpperCase()}`);
  if (data.rca.rootCause.supportingEvidence.length > 0) {
    lines.push("**Evidence:**");
    for (const e of data.rca.rootCause.supportingEvidence) {
      lines.push(`  - ${e}`);
    }
  }
  lines.push("");

  // Bottlenecks
  if (data.rca.bottlenecks.length > 0) {
    lines.push("## Bottlenecks");
    for (const b of data.rca.bottlenecks) {
      lines.push(`- **${b.resource} — ${b.service}${b.pod ? ` (${b.pod})` : ""}:** ${b.description}`);
      lines.push(`  - Evidence: ${b.evidence}`);
    }
    lines.push("");
  }

  // Recommendations
  if (data.rca.recommendations.length > 0) {
    lines.push("## Recommendations");
    for (let i = 0; i < data.rca.recommendations.length; i++) {
      const r = data.rca.recommendations[i];
      lines.push(`${i + 1}. **[${r.priority.toUpperCase()}]** ${r.action}`);
      lines.push(`   - ${r.rationale}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatPlainText(data: ReportData): string {
  const lines: string[] = [];

  lines.push("KUBERNETES ROOT CAUSE ANALYSIS REPORT");
  lines.push("=".repeat(50));
  lines.push(`Generated: ${data.generatedAt}`);
  lines.push(`Namespace: ${data.namespace}`);
  lines.push(`Time Window: ${data.timeWindowMinutes} minutes`);
  lines.push(`Mode: ${data.mode}`);
  lines.push("");

  if (data.healthSummary) {
    const h = data.healthSummary;
    lines.push("CLUSTER HEALTH SNAPSHOT");
    lines.push("-".repeat(30));
    lines.push(`Total pods: ${h.totalPods} | Running: ${h.runningPods} | Pending: ${h.pendingPods} | Failed: ${h.failedPods} | CrashLoop: ${h.crashLoopPods}`);
    lines.push(`Total restarts: ${h.totalRestarts}`);
    lines.push(`Warning events (last ${data.timeWindowMinutes}m): ${h.recentWarningEvents}`);
    lines.push("");
  }

  if (data.anomalies.length > 0) {
    lines.push("ANOMALIES DETECTED");
    lines.push("-".repeat(30));
    for (const a of data.anomalies) {
      lines.push(`[${a.severity.toUpperCase()}] ${formatAnomalyType(a.type)} - ${a.pod || a.service}`);
      lines.push(`  Description: ${a.description}`);
      if (a.evidence.currentValue !== undefined && a.evidence.threshold !== undefined) {
        lines.push(`  Value: ${a.evidence.currentValue} (threshold: ${a.evidence.threshold})`);
      }
      if (a.evidence.sampleLogLines?.length) {
        lines.push("  Sample log lines:");
        for (const line of a.evidence.sampleLogLines) {
          lines.push(`    - ${line}`);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("ANOMALIES DETECTED");
    lines.push("-".repeat(30));
    lines.push("No anomalies detected in the given time window.");
    lines.push("");
  }

  if (data.rca.timeline.length > 0) {
    lines.push("CORRELATION TIMELINE");
    lines.push("-".repeat(30));
    for (const t of data.rca.timeline) {
      lines.push(`  ${t.timestamp}  ${t.severity.toUpperCase().padEnd(8)}  ${t.service.padEnd(20)}  ${truncate(t.event, 50)}`);
    }
    lines.push("");
  }

  if (data.rca.correlations.length > 0) {
    lines.push("CORRELATIONS");
    lines.push("-".repeat(30));
    for (const c of data.rca.correlations) {
      lines.push(`  ${c.eventA} -> ${c.eventB}`);
      lines.push(`    Delta: ${c.timeDeltaSeconds}s | Confidence: ${c.confidence.toUpperCase()}`);
      lines.push(`    ${c.relationship}`);
      lines.push("");
    }
  }

  lines.push("ROOT CAUSE");
  lines.push("-".repeat(30));
  lines.push(`Hypothesis: ${data.rca.rootCause.hypothesis}`);
  lines.push(`Confidence: ${data.rca.rootCause.confidence.toUpperCase()}`);
  if (data.rca.rootCause.supportingEvidence.length > 0) {
    lines.push("Evidence:");
    for (const e of data.rca.rootCause.supportingEvidence) {
      lines.push(`  - ${e}`);
    }
  }
  lines.push("");

  if (data.rca.bottlenecks.length > 0) {
    lines.push("BOTTLENECKS");
    lines.push("-".repeat(30));
    for (const b of data.rca.bottlenecks) {
      lines.push(`  ${b.resource} - ${b.service}${b.pod ? ` (${b.pod})` : ""}: ${b.description}`);
      lines.push(`    Evidence: ${b.evidence}`);
    }
    lines.push("");
  }

  if (data.rca.recommendations.length > 0) {
    lines.push("RECOMMENDATIONS");
    lines.push("-".repeat(30));
    for (let i = 0; i < data.rca.recommendations.length; i++) {
      const r = data.rca.recommendations[i];
      lines.push(`  ${i + 1}. [${r.priority.toUpperCase()}] ${r.action}`);
      lines.push(`     ${r.rationale}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatAnomalyType(type: string): string {
  const map: Record<string, string> = {
    cpu_spike: "CPU Spike",
    memory_spike: "Memory Spike",
    error_burst: "Error Burst",
    restart_storm: "Restart Storm",
    event_flood: "Event Flood",
    oom_kill: "OOM Kill",
  };
  return map[type] ?? type;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}
