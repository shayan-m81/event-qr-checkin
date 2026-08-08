import { inspectStoredOfflineGrant, type OfflineGrantPayload } from "../lib/offlineGrant";
import { getOfflineSummary } from "../lib/offlineStore";
import { checkServiceWorkerReadiness } from "../lib/serviceWorkerReadiness";

export type OfflineBootstrapResult =
  | { authorized: true; grant: OfflineGrantPayload }
  | { authorized: false; reason: string };

export async function authorizeOfflinePrimary(): Promise<OfflineBootstrapResult> {
  const grant = await inspectStoredOfflineGrant();
  if (!grant.valid) return { authorized: false, reason: grant.detail };

  const summary = await getOfflineSummary();
  if (!summary.lastSyncAt) return { authorized: false, reason: "No offline ticket snapshot is prepared" };

  const serviceWorker = await checkServiceWorkerReadiness();
  if (!serviceWorker.registered || !serviceWorker.controlled) {
    return { authorized: false, reason: serviceWorker.detail ?? "The Service Worker is not controlling this page" };
  }
  if (!serviceWorker.shellCached) {
    return { authorized: false, reason: serviceWorker.missing.length > 0
      ? `Application shell is incomplete: ${serviceWorker.missing.join(", ")}`
      : "The offline application shell is unavailable" };
  }
  return { authorized: true, grant: grant.payload };
}
