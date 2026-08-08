import { EXPECTED_SERVICE_WORKER_PATH, SERVICE_WORKER_CHECK_TIMEOUT_MS } from "../config/readiness";

export type ServiceWorkerReadiness = {
  registered: boolean;
  controlled: boolean;
  shellCached: boolean;
  missing: string[];
  detail?: string;
};

const unavailable = (detail: string): ServiceWorkerReadiness => ({
  registered: false, controlled: false, shellCached: false, missing: [], detail,
});

export async function checkServiceWorkerReadiness(): Promise<ServiceWorkerReadiness> {
  if (!("serviceWorker" in navigator)) return unavailable("Service Workers are unavailable in this browser");
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return unavailable("No Service Worker is registered");
  const controller = navigator.serviceWorker.controller;
  if (!controller) return { ...unavailable("Reload once online to let the Service Worker control this page"), registered: true };
  if (new URL(controller.scriptURL, location.href).pathname !== EXPECTED_SERVICE_WORKER_PATH) {
    return { ...unavailable("An unexpected Service Worker controls this page"), registered: true };
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => resolve({
      registered: true, controlled: true, shellCached: false, missing: [], detail: "Service Worker readiness check timed out",
    }), SERVICE_WORKER_CHECK_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<{
      type?: string; shellCached?: boolean; missing?: unknown;
    }>) => {
      window.clearTimeout(timeout);
      const missing = Array.isArray(event.data?.missing)
        ? event.data.missing.filter((item): item is string => typeof item === "string")
        : [];
      resolve({
        registered: true,
        controlled: true,
        shellCached: event.data?.type === "READINESS_RESULT" && event.data.shellCached === true,
        missing,
        detail: event.data?.shellCached ? undefined : "Required application shell resources are not cached",
      });
    };
    controller.postMessage({ type: "READINESS_CHECK" }, [channel.port2]);
  });
}
