import type { IScannerControls } from "@zxing/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { roleLabels } from "../auth/authorization";
import { AppShell } from "../components/AppShell";
import { CheckinApiError, isTicketToken, submitCheckin, type CheckinResponse } from "../lib/checkinApi";
import { cameraErrorMessage } from "../lib/cameraErrors";
import { refreshOfflineSnapshot, synchronizePendingOperations } from "../lib/offlineApi";
import { checkInOffline, getOfflineSummary, isOfflineModeEnabled, setOfflineModeEnabled, type OfflineSummary } from "../lib/offlineStore";
import { ScanGuard } from "../lib/scanGuard";

export const scannerStates = [
  "READY", "VALID", "ALREADY_USED", "INVALID", "VOIDED",
  "CONNECTION_LOST_PRIMARY", "CONNECTION_LOST_SECONDARY", "OFFLINE_PRIMARY", "CAMERA_ERROR",
] as const;

export type ScannerState = (typeof scannerStates)[number];

const labels: Record<ScannerState, string> = {
  READY: "Ready to scan", VALID: "Valid ticket", ALREADY_USED: "Already used",
  INVALID: "Invalid ticket", VOIDED: "Ticket cancelled",
  CONNECTION_LOST_PRIMARY: "Primary connection lost",
  CONNECTION_LOST_SECONDARY: "Secondary scanning disabled",
  OFFLINE_PRIMARY: "Primary emergency offline scanning",
  CAMERA_ERROR: "Camera unavailable",
};

const emptySummary: OfflineSummary = { cachedTicketCount: 0, pendingCount: 0, conflictCount: 0, lastSyncAt: null };
function formatTime(value?: string | null): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(parsed);
}

type ScannerPanelProps = {
  state: ScannerState;
  result: CheckinResponse | null;
  offlineMode: boolean;
  pendingCount: number;
  confirmedSecondaryStopped: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraMessage: string;
  connectionMessage: string;
  backToScanner: () => void;
  setConfirmed: (confirmed: boolean) => void;
  startOffline: () => void;
  canStartOffline: boolean;
  secondaryRole: boolean;
};

function Camera({ videoRef, offlineMode, pendingCount }: Pick<ScannerPanelProps, "videoRef" | "offlineMode" | "pendingCount">) {
  return (
    <div className={`camera-panel live-camera ${offlineMode ? "offline-camera" : ""}`}>
      <video ref={videoRef} className="camera-video" muted playsInline aria-label="Live rear camera preview" />
      <div className="camera-shade" aria-hidden="true" /><div className="camera-corners" aria-hidden="true" />
      <div className="camera-ready-label"><i /><span>{offlineMode ? "Emergency Offline" : "Ready to Scan"}</span></div>
      <span className="camera-mock-label">Center ticket QR code</span>
      {offlineMode && <div className="offline-queue"><strong>{pendingCount}</strong> pending sync</div>}
    </div>
  );
}

function ScannerPanel(props: ScannerPanelProps) {
  const { state, result, offlineMode, backToScanner } = props;
  if (state === "VALID") return (
    <div className="scan-result success" role="status" aria-live="assertive" aria-atomic="true">
      <div className="result-icon">✓</div><p>{offlineMode ? "Saved offline" : "Ticket accepted"}</p>
      <h2>{result?.guestName ?? "Ticket accepted"}</h2>{result?.ticketType && <span>{result.ticketType}</span>}
      {offlineMode && <span className="provisional-note">Provisional until synchronized</span>}
      <small className="auto-return-note">Returning to scanner…</small>
    </div>
  );
  if (state === "ALREADY_USED") return (
    <div className="scan-result danger" role="alert" aria-live="assertive" aria-atomic="true">
      <div className="result-icon">!</div><p>Already checked in</p><h2>{result?.guestName ?? "Ticket already used"}</h2>
      <span>{offlineMode ? "Already marked in this device snapshot" : `First checked in at ${formatTime(result?.checkedInAt)}`}</span>
      <button className="button result-button" onClick={backToScanner}>Back to Scanner</button>
    </div>
  );
  if (state === "INVALID" || state === "VOIDED") return (
    <div className="scan-result danger" role="alert" aria-live="assertive" aria-atomic="true">
      <div className="result-icon">×</div><p>{state === "VOIDED" ? "TICKET CANCELLED" : "Ticket not recognized"}</p>
      <h2>{state === "VOIDED" ? "DO NOT ADMIT" : "Invalid QR code"}</h2>
      <span>{state === "VOIDED"
        ? `${result?.guestName ?? "This guest"} · ${offlineMode ? "cancelled in the last refreshed offline snapshot" : "cancelled by Admin"}`
        : offlineMode ? "Checked against the last local snapshot." : "No valid ticket matched this code."}</span>
      <button className="button result-button" onClick={backToScanner}>Back to Scanner</button>
    </div>
  );
  if (state === "CONNECTION_LOST_PRIMARY") return (
    <div className="connection-card" role="alert">
      <div className="connection-icon">↯</div><p className="eyebrow">Connection lost</p>
      <h2>Online scanning stopped.</h2><p>{props.connectionMessage}</p>
      <label className="offline-confirmation">
        <input type="checkbox" checked={props.confirmedSecondaryStopped} onChange={(event) => props.setConfirmed(event.target.checked)} />
        <span>I confirm the secondary scanner has stopped</span>
      </label>
      <button className="button button-warning" disabled={!props.confirmedSecondaryStopped || !props.canStartOffline} onClick={props.startOffline}>
        Start Offline Scanning
      </button>
      <button className="text-button" onClick={backToScanner}>Retry connection</button>
    </div>
  );
  if (state === "CONNECTION_LOST_SECONDARY") return (
    <div className="connection-card secondary-lockout" role="alert">
      <div className="connection-icon">×</div><p className="eyebrow">Scanning disabled</p>
      <h2>Use Primary Scanner</h2><p>{props.secondaryRole
        ? "This secondary device cannot accept tickets without the server. There is no offline override."
        : "This account can scan online only. Emergency offline mode requires the Primary Scanner role."}</p>
      <button className="button button-warning" onClick={backToScanner}>Retry connection</button>
    </div>
  );
  if (state === "CAMERA_ERROR") return (
    <div className="connection-card camera-error-card" role="alert">
      <div className="connection-icon">⌗</div><p className="eyebrow">Camera unavailable</p>
      <h2>Can’t start scanning.</h2><p>{props.cameraMessage}</p>
      <button className="button button-secondary" onClick={backToScanner}>Try camera again</button>
    </div>
  );
  return <Camera videoRef={props.videoRef} offlineMode={offlineMode} pendingCount={props.pendingCount} />;
}

export function ScannerPage() {
  const { state: authState } = useAuth();
  if (authState.status !== "AUTHENTICATED" && authState.status !== "OFFLINE_AUTHORIZED_PRIMARY") return null;
  const offlineAuthorized = authState.status === "OFFLINE_AUTHORIZED_PRIMARY";
  const role = authState.role;
  const canUseEmergencyOffline = role === "PRIMARY_SCANNER";
  const [state, setState] = useState<ScannerState>(offlineAuthorized ? "CONNECTION_LOST_PRIMARY" : "READY");
  const [result, setResult] = useState<CheckinResponse | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(() => offlineAuthorized ? false : navigator.onLine);
  const [confirmedSecondaryStopped, setConfirmedSecondaryStopped] = useState(false);
  const [summary, setSummary] = useState<OfflineSummary>(emptySummary);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [checkedInCount, setCheckedInCount] = useState<number | null>(null);
  const [cameraMessage, setCameraMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("Check your signal. No online ticket was accepted.");
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const scanGuardRef = useRef(new ScanGuard());
  const syncLockRef = useRef(false);
  const mountedRef = useRef(true);
  const autoReturnRef = useRef<number | null>(null);
  const connectionLostState = role === "PRIMARY_SCANNER" ? "CONNECTION_LOST_PRIMARY" : "CONNECTION_LOST_SECONDARY";

  const updateSummary = useCallback(async () => {
    const nextSummary = await getOfflineSummary();
    if (mountedRef.current) setSummary(nextSummary);
  }, []);
  const stopCamera = useCallback(() => { controlsRef.current?.stop(); controlsRef.current = null; }, []);
  const syncAndRefresh = useCallback(async () => {
    if (offlineAuthorized || role !== "PRIMARY_SCANNER" || syncLockRef.current || !navigator.onLine) return false;
    syncLockRef.current = true;
    setSyncing(true);
    try {
      const syncResult = await synchronizePendingOperations();
      await refreshOfflineSnapshot();
      await updateSummary();
      if (!mountedRef.current) return false;
      setNetworkOnline(true);
      setSyncNotice(syncResult.conflicts > 0
        ? `${syncResult.conflicts} synchronization conflict${syncResult.conflicts === 1 ? "" : "s"} sent to admin.`
        : "ALL CHECK-INS SYNCED");
      if (offlineMode && canUseEmergencyOffline) {
        await setOfflineModeEnabled(false);
        setOfflineMode(false);
        setConfirmedSecondaryStopped(false);
        setState("READY");
      }
      return true;
    } catch {
      if (!mountedRef.current) return false;
      setNetworkOnline(false);
      if (!offlineMode) setState("CONNECTION_LOST_PRIMARY");
      return false;
    } finally {
      syncLockRef.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  }, [canUseEmergencyOffline, offlineAuthorized, offlineMode, role, updateSummary]);

  const backToScanner = useCallback(() => {
    if (autoReturnRef.current !== null) window.clearTimeout(autoReturnRef.current);
    autoReturnRef.current = null; scanGuardRef.current.ready(); setResult(null);
    if (!navigator.onLine && !offlineMode) {
      setState(connectionLostState);
    } else setState(offlineMode ? "OFFLINE_PRIMARY" : "READY");
  }, [connectionLostState, offlineMode]);

  const processToken = useCallback(async (token: string, controls: IScannerControls) => {
    const normalizedToken = scanGuardRef.current.begin(token);
    if (!normalizedToken) return;
    controls.stop(); controlsRef.current = null;
    if (!isTicketToken(normalizedToken)) {
      setResult({ state: "INVALID", checkedInCount: checkedInCount ?? 0 });
      setState("INVALID");
      return;
    }
    try {
      if (offlineMode && canUseEmergencyOffline) {
        const local = await checkInOffline(normalizedToken);
        const localResult: CheckinResponse = {
          state: local.state,
          guestName: "ticket" in local ? local.ticket.guestName : undefined,
          ticketType: "ticket" in local ? local.ticket.ticketType : undefined,
          checkedInAt: "ticket" in local ? local.ticket.checkedInAt ?? undefined : undefined,
          checkedInCount: checkedInCount ?? 0,
        };
        if (!mountedRef.current) return;
        setResult(localResult); setState(local.state); await updateSummary();
        if (local.state === "VALID") autoReturnRef.current = window.setTimeout(backToScanner, 1_250);
      } else {
        const checkinResult = await submitCheckin(normalizedToken);
        if (!mountedRef.current) return;
        setResult(checkinResult); setCheckedInCount(checkinResult.checkedInCount); setState(checkinResult.state);
        if (checkinResult.state === "VALID") autoReturnRef.current = window.setTimeout(backToScanner, 1_250);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof CheckinApiError && error.status === 400) {
        setResult({ state: "INVALID", checkedInCount: checkedInCount ?? 0 });
        setState("INVALID");
        return;
      }
      setNetworkOnline(false);
      setConnectionMessage(error instanceof CheckinApiError && (error.status === 401 || error.status === 403)
        ? "Your scanner session is not authorized. Sign in again."
        : "Check your signal. No online ticket was accepted.");
      setState(connectionLostState);
    }
  }, [backToScanner, canUseEmergencyOffline, checkedInCount, connectionLostState, offlineMode, updateSummary]);

  useEffect(() => {
    if (canUseEmergencyOffline || !offlineMode) return;
    void setOfflineModeEnabled(false);
    setOfflineMode(false);
    setConfirmedSecondaryStopped(false);
    setState("READY");
  }, [canUseEmergencyOffline, offlineMode]);

  useEffect(() => {
    let cancelled = false;
    if (offlineAuthorized) {
      void Promise.all([updateSummary(), isOfflineModeEnabled()]).then(([, enabled]) => {
        if (cancelled) return;
        setOfflineMode(enabled);
        setState(enabled ? "OFFLINE_PRIMARY" : "CONNECTION_LOST_PRIMARY");
      });
    } else if (role === "PRIMARY_SCANNER") {
      void updateSummary().then(refreshOfflineSnapshot).then(updateSummary).catch(() => {
        if (cancelled) return;
        setNetworkOnline(false);
        setState("CONNECTION_LOST_PRIMARY");
      });
    }
    return () => { cancelled = true; };
  }, [offlineAuthorized, role, updateSummary]);

  useEffect(() => {
    const online = () => {
      setNetworkOnline(true);
      if (offlineAuthorized) return;
      if (role === "PRIMARY_SCANNER") void syncAndRefresh(); else setState("READY");
    };
    const offline = () => { setNetworkOnline(false); if (!offlineMode) setState(connectionLostState); };
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [connectionLostState, offlineAuthorized, offlineMode, role, syncAndRefresh]);

  useEffect(() => {
    if (offlineAuthorized || role !== "PRIMARY_SCANNER") return;
    const interval = window.setInterval(() => { if (navigator.onLine) void syncAndRefresh(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [offlineAuthorized, role, syncAndRefresh]);

  useEffect(() => {
    const cameraReady = state === "READY" || state === "OFFLINE_PRIMARY";
    if (!cameraReady) { stopCamera(); return; }
    let cancelled = false; scanGuardRef.current.ready(); setCameraMessage("");
    if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
      setCameraMessage("Camera access is unavailable in this browser. Use a supported browser over HTTPS."); setState("CAMERA_ERROR"); return;
    }
    const preview = videoRef.current;
    void import("@zxing/browser").then(({ BrowserQRCodeReader }) => {
      if (cancelled) return undefined;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500 });
      return reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }, preview,
        (decoded, _error, controls) => { controlsRef.current = controls; if (decoded) void processToken(decoded.getText(), controls); });
    }).then((controls) => { if (!controls) return; if (cancelled) controls.stop(); else controlsRef.current = controls; })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCameraMessage(cameraErrorMessage(error));
        setState("CAMERA_ERROR");
      });
    return () => { cancelled = true; stopCamera(); };
  }, [processToken, state, stopCamera]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
      if (autoReturnRef.current !== null) window.clearTimeout(autoReturnRef.current);
    };
  }, [stopCamera]);

  function setDeveloperState(nextState: ScannerState) {
    setResult(["VALID", "ALREADY_USED", "VOIDED"].includes(nextState)
      ? {
          state: nextState as CheckinResponse["state"],
          guestName: "Review ticket",
          ticketType: "General admission",
          checkedInAt: "2026-08-08T21:42:00.000Z",
          checkedInCount: 0,
        }
      : null);
    setState(nextState);
  }

  const connectionProblem = !networkOnline || state.startsWith("CONNECTION_LOST") || offlineMode;
  return (
    <AppShell eyebrow="Door scanner" title="Check in"
      action={<span className={`status-pill ${connectionProblem ? "offline" : "online"}`}><i />{offlineMode ? "Offline" : networkOnline ? "Online" : "No signal"}</span>}>
      <section className="event-ready-card" aria-label="Event ready status">
        <div><p className="eyebrow">Event Ready</p><strong>{roleLabels[role]}</strong></div>
        <dl>
          <div><dt>Cached tickets</dt><dd>{summary.cachedTicketCount}</dd></div>
          <div><dt>Last sync</dt><dd>{formatTime(summary.lastSyncAt)}</dd></div>
          <div><dt>Network</dt><dd className={networkOnline ? "green-text" : "orange-text"}>{networkOnline ? "Online" : "Offline"}</dd></div>
          <div><dt>Pending</dt><dd>{summary.pendingCount}</dd></div>
        </dl>
        {summary.conflictCount > 0 && <p className="sync-conflict-note">{summary.conflictCount} local conflict record{summary.conflictCount === 1 ? "" : "s"}</p>}
        {syncNotice && <p className="sync-notice" role="status">{syncNotice}</p>}
        {!offlineAuthorized && role === "PRIMARY_SCANNER" && networkOnline && (summary.pendingCount > 0 || offlineMode) &&
          <button className="button button-secondary compact-button" disabled={syncing} onClick={() => void syncAndRefresh()}>{syncing ? "Syncing…" : "Sync Now"}</button>}
      </section>
      <ScannerPanel state={state} result={result} offlineMode={offlineMode} pendingCount={summary.pendingCount}
        confirmedSecondaryStopped={confirmedSecondaryStopped} videoRef={videoRef} cameraMessage={cameraMessage}
        connectionMessage={connectionMessage} backToScanner={backToScanner} setConfirmed={setConfirmedSecondaryStopped}
        canStartOffline={role === "PRIMARY_SCANNER"}
        secondaryRole={role === "SECONDARY_SCANNER"}
        startOffline={() => {
          if (role !== "PRIMARY_SCANNER") return;
          void setOfflineModeEnabled(true).then(() => {
            setOfflineMode(true); setSyncNotice(""); setState("OFFLINE_PRIMARY");
          }).catch(() => setConnectionMessage("Offline mode could not be persisted on this device."));
        }} />
      <div className="scan-stats">
        <div><strong>{checkedInCount ?? "—"}</strong><span>Checked in</span></div>
        <div><strong>{offlineMode ? "Local" : "Live"}</strong><span>Validation</span></div>
        <div><strong>{offlineMode ? "Queue" : "D1"}</strong><span>Authority</span></div>
      </div>
      {!offlineAuthorized && <button className="button button-secondary" type="button" onClick={() => navigate("/guests")}><span aria-hidden="true">⌕</span> Guest Search</button>}
      {import.meta.env.DEV && <section className="developer-panel" aria-labelledby="developer-title">
        <div><p id="developer-title">Developer state switcher</p><span>Development only</span></div>
        <label htmlFor="scanner-state">Scanner screen state</label>
        <select id="scanner-state" value={state} onChange={(event) => setDeveloperState(event.target.value as ScannerState)}>
          {scannerStates.map((item) => <option key={item} value={item}>{item} — {labels[item]}</option>)}
        </select>
      </section>}
    </AppShell>
  );
}
