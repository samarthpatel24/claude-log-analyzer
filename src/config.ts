export interface Config {
  kubeconfig: string | undefined;
  context: string | undefined;
  defaultNamespace: string;
  logMaxLines: number;
  defaultTimeWindowMinutes: number;
  defaultMode: "logs" | "metrics" | "both";
}

export function loadConfig(): Config {
  return {
    kubeconfig: process.env.KUBECONFIG || undefined,
    context: process.env.K8S_CONTEXT || undefined,
    defaultNamespace: process.env.K8S_DEFAULT_NAMESPACE || "default",
    logMaxLines: parseInt(process.env.K8S_LOG_MAX_LINES || "500", 10),
    defaultTimeWindowMinutes: parseInt(process.env.K8S_TIME_WINDOW || "60", 10),
    defaultMode: (process.env.K8S_MODE as Config["defaultMode"]) || "both",
  };
}

export const config = loadConfig();
