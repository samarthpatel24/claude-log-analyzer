export function computeAge(startTime: Date | undefined): string {
  if (!startTime) return "unknown";
  const diffMs = Date.now() - startTime.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h${diffMin % 60}m`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d${diffHr % 24}h`;
}

export function extractServiceName(podName: string): string {
  // Remove ReplicaSet hash and pod hash: my-service-7f8b9c4d5-x2k4j -> my-service
  // A hash segment is 4–10 alphanumeric chars containing at least one digit.
  // Requiring a digit prevents plain words (e.g. "service") from being stripped.
  const parts = podName.split("-");
  if (parts.length >= 3) {
    let end = parts.length;
    while (end > 1 && /^[a-z0-9]{4,10}$/.test(parts[end - 1]) && /\d/.test(parts[end - 1])) {
      end--;
    }
    return parts.slice(0, Math.max(1, end)).join("-");
  }
  return podName;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}Ki`;
  return `${bytes}B`;
}

export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}
