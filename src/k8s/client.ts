import * as k8s from "@kubernetes/client-node";
import { config } from "../config.js";

let kubeConfig: k8s.KubeConfig | null = null;

function getKubeConfig(): k8s.KubeConfig {
  if (kubeConfig) return kubeConfig;

  kubeConfig = new k8s.KubeConfig();

  if (config.kubeconfig) {
    kubeConfig.loadFromFile(config.kubeconfig);
  } else {
    kubeConfig.loadFromDefault();
  }

  if (config.context) {
    kubeConfig.setCurrentContext(config.context);
  }

  return kubeConfig;
}

export function getCoreV1Api(): k8s.CoreV1Api {
  return getKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function getAppsV1Api(): k8s.AppsV1Api {
  return getKubeConfig().makeApiClient(k8s.AppsV1Api);
}

export function getCustomObjectsApi(): k8s.CustomObjectsApi {
  return getKubeConfig().makeApiClient(k8s.CustomObjectsApi);
}
