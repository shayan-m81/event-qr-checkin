import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { roleLabels } from "../auth/authorization";
import { AppShell } from "../components/AppShell";
import { appBuildId } from "../config/appVersion";
import { currentCameraReadiness, verifyCameraReadiness, type CameraReadinessState } from "../lib/cameraReadiness";
import { confirmOfflineDrill, getOfflineDrillConfirmation, type OfflineDrillConfirmation } from "../lib/offlineDrill";
import { prepareOfflineDevice, refreshOfflineSnapshot, synchronizePendingOperations } from "../lib/offlineApi";
import { inspectStoredOfflineGrant } from "../lib/offlineGrant";
import { getOfflineSummary, type OfflineSummary } from "../lib/offlineStore";
import { evaluateReadiness, type ReadinessItem, type ReadinessResult, type ServerReadiness } from "../lib/readiness";
import { requestWithTimeout } from "../lib/request";
import { checkServiceWorkerReadiness, type ServiceWorkerReadiness } from "../lib/serviceWorkerReadiness";

const emptyOffline: OfflineSummary = { cachedTicketCount: 0, pendingCount: 0, conflictCount: 0, lastSyncAt: null };
const emptyWorker: ServiceWorkerReadiness = { registered: false, controlled: false, shellCached: false, missing: [] };
const checkingItems: ReadinessItem[] = [
  "Authorized Role", "Server Connection", "Tickets on Server", "Tickets Cached Offline", "Offline Cache",
  "Pending Offline Check-ins", "Offline Authorization", "Service Worker", "App Shell", "Camera",
].map((label) => ({ id: label, label, status: "CHECKING", value: "CHECKING" }));

async function serverReadiness(): Promise<ServerReadiness> {
  try {
    const response = await requestWithTimeout("/api/readiness/status", { headers: { Accept: "application/json" } });
    if (!response.ok) return { reachable: false, ticketCount: null, error: `Readiness API returned HTTP ${response.status}` };
    const body = await response.json() as { ticketCount?: unknown };
    if (!Number.isSafeInteger(body.ticketCount) || Number(body.ticketCount) < 0) {
      return { reachable: true, ticketCount: null, error: "Readiness API returned an invalid ticket count" };
    }
    return { reachable: true, ticketCount: Number(body.ticketCount) };
  } catch (error) {
    return { reachable: false, ticketCount: null, error: error instanceof Error ? error.message : "Server request failed" };
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(date);
}

export function ReadinessPage() {
  const { state: authState } = useAuth();
  if (authState.status !== "AUTHENTICATED") return null;
  const role = authState.role;
  const [result, setResult] = useState<ReadinessResult | null>(null);
  const [offline, setOffline] = useState(emptyOffline);
  const [camera, setCamera] = useState<CameraReadinessState>("PERMISSION_REQUIRED");
  const [checking, setChecking] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checkingCamera, setCheckingCamera] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<OfflineDrillConfirmation | null>(() => getOfflineDrillConfirmation());

  const runCheck = useCallback(async () => {
    setChecking(true);
    const [server, local, serviceWorker, cameraState, offlineAuthorization] = await Promise.all([
      serverReadiness(),
      getOfflineSummary().catch(() => emptyOffline),
      checkServiceWorkerReadiness().catch((workerError: unknown) => ({
        ...emptyWorker,
        detail: workerError instanceof Error ? workerError.message : "Service Worker check failed",
      })),
      currentCameraReadiness(),
      inspectStoredOfflineGrant(),
    ]);
    setOffline(local);
    setCamera(cameraState);
    setResult(evaluateReadiness({ role, server, offline: local, serviceWorker, camera: cameraState, offlineAuthorization }));
    setChecking(false);
  }, [role]);

  useEffect(() => { void runCheck(); }, [runCheck]);

  async function refreshCache() {
    setRefreshing(true); setNotice(""); setError("");
    try {
      if (role === "PRIMARY_SCANNER") {
        await prepareOfflineDevice();
        setNotice("Offline cache and authorization prepared");
      } else {
        await refreshOfflineSnapshot();
        setNotice("Offline cache updated. Sign in as Primary Scanner on this device to issue offline authorization.");
      }
    } catch (refreshError) {
      setError(`Offline cache update failed: ${refreshError instanceof Error ? refreshError.message : "unknown error"}. The previous cache was kept.`);
    } finally {
      setRefreshing(false);
      await runCheck();
    }
  }

  async function syncNow() {
    if (role !== "PRIMARY_SCANNER") return;
    setSyncing(true); setNotice(""); setError("");
    try {
      const sync = await synchronizePendingOperations();
      await refreshOfflineSnapshot();
      setNotice(sync.conflicts > 0 ? `${sync.conflicts} synchronization conflict${sync.conflicts === 1 ? "" : "s"} require Admin review.` : "All pending check-ins synchronized");
    } catch (syncError) {
      setError(`Synchronization failed: ${syncError instanceof Error ? syncError.message : "unknown error"}`);
    } finally {
      setSyncing(false);
      await runCheck();
    }
  }

  async function checkCamera() {
    setCheckingCamera(true); setNotice(""); setError("");
    const nextCamera = await verifyCameraReadiness();
    setCamera(nextCamera);
    setCheckingCamera(false);
    await runCheck();
  }

  const overallReady = result?.ready === true;
  return (
    <AppShell eyebrow="Pre-event check" title="Event Readiness">
      <section className={`readiness-overall ${overallReady ? "ready" : "not-ready"}`} role="status" aria-live="polite">
        <p>{checking ? "CHECKING" : overallReady ? "EVENT READY" : "NOT READY"}</p>
        <strong aria-hidden="true">{checking ? "…" : overallReady ? "✓" : "!"}</strong>
        <span>{roleLabels[role]}</span>
      </section>

      {notice && <p className="readiness-notice" role="status">{notice}</p>}
      {error && <p className="readiness-error" role="alert">{error}</p>}

      <section className="readiness-list" aria-label="Readiness checks" aria-busy={checking}>
        {(result?.items ?? checkingItems).map((item) => (
          <div className="readiness-row" key={item.id}>
            <div><strong>{item.label}</strong><span>{item.value}</span>{item.detail && <small>{item.detail}</small>}</div>
            <b className={`readiness-state ${item.status.toLowerCase()}`}><i aria-hidden="true">{item.status === "PASS" ? "✓" : item.status === "WARNING" ? "△" : item.status === "FAIL" ? "×" : "…"}</i>{item.status}</b>
          </div>
        ))}
        <div className="readiness-row">
          <div><strong>Last Sync</strong><span>{formatDateTime(offline.lastSyncAt)}</span></div>
          <b className="readiness-state checking">INFO</b>
        </div>
        <div className="readiness-row">
          <div>
            <strong>Offline Drill</strong>
            <span>{drill ? "PASSED" : "NOT TESTED"}</span>
            <small>{drill ? `${formatDateTime(drill.confirmedAt)} · ${drill.deviceBrowser} · ${drill.buildId}` : "Strongly recommended before doors open"}</small>
          </div>
          <b className={`readiness-state ${drill ? "pass" : "warning"}`}>{drill ? "✓ PASS" : "△ WARNING"}</b>
        </div>
      </section>

      {!checking && !overallReady && result && (
        <section className="readiness-actions" aria-labelledby="readiness-actions-title">
          <h2 id="readiness-actions-title">Fix before doors open</h2>
          <ul>{result.actions.map((action) => <li key={action}>{action}</li>)}</ul>
          {offline.pendingCount > 0 && role === "ADMIN" && <p>Sign in as Primary Scanner on this device to synchronize pending offline check-ins.</p>}
        </section>
      )}

      <div className="readiness-buttons">
        <button className="button button-primary" type="button" disabled={refreshing || checking} onClick={() => void refreshCache()}>
          {refreshing ? "Preparing…" : role === "PRIMARY_SCANNER" ? "Prepare Device for Offline" : "Refresh Offline Cache"}
        </button>
        <button className="button button-secondary" type="button" disabled={checking} onClick={() => { setError(""); setNotice(""); void runCheck(); }}>
          {checking ? "Running check…" : "Run Readiness Check"}
        </button>
        {camera !== "READY" && <button className="button button-secondary" type="button" disabled={checkingCamera} onClick={() => void checkCamera()}>
          {checkingCamera ? "Checking camera…" : "Check Camera"}
        </button>}
        {offline.pendingCount > 0 && role === "PRIMARY_SCANNER" && <button className="button button-warning" type="button" disabled={syncing} onClick={() => void syncNow()}>
          {syncing ? "Synchronizing…" : "Sync Now"}
        </button>}
      </div>

      <section className="offline-drill-guide" aria-labelledby="offline-drill-title">
        <p className="eyebrow">Guided manual test</p><h2 id="offline-drill-title">Offline Drill</h2>
        <ol>
          <li>Complete all readiness checks.</li><li>Stop the Secondary Scanner.</li><li>Enable airplane mode on this phone.</li>
          <li>Reload the application.</li><li>Confirm `/scan` still opens.</li><li>Enter Emergency Offline Mode.</li>
          <li>Scan a test ticket.</li><li>Reload the page again.</li><li>Confirm the check-in remains pending locally.</li>
          <li>Restore internet.</li><li>Sync.</li><li>Confirm Pending Offline Check-ins returns to 0.</li>
        </ol>
        <p className="drill-warning">Airplane mode cannot be enabled by this application. A prepared Primary device can reopen only the offline scanner with its signed grant; synchronization still requires a real server session after reconnecting.</p>
        <button className="button button-secondary" type="button" onClick={() => setDrill(confirmOfflineDrill(appBuildId))}>Offline Drill Passed</button>
      </section>

      <p className="build-id">Build: {appBuildId}</p>
    </AppShell>
  );
}
