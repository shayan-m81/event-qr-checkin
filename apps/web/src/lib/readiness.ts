import type { Role } from "../auth/authorization";
import { OFFLINE_CACHE_FRESHNESS_MS } from "../config/readiness";
import type { CameraReadinessState } from "./cameraReadiness";
import type { OfflineSummary } from "./offlineStore";
import type { OfflineGrantStatus } from "./offlineGrant";
import type { ServiceWorkerReadiness } from "./serviceWorkerReadiness";

export type ReadinessStatus = "PASS" | "WARNING" | "FAIL" | "CHECKING";

export type ReadinessItem = {
  id: string;
  label: string;
  status: ReadinessStatus;
  value: string;
  detail?: string;
};

export type ServerReadiness = {
  reachable: boolean;
  ticketCount: number | null;
  error?: string;
};

export type ReadinessResult = {
  ready: boolean;
  items: ReadinessItem[];
  actions: string[];
};

function cameraItem(camera: CameraReadinessState): ReadinessItem {
  const status = camera === "READY" ? "PASS" : camera === "PERMISSION_REQUIRED" ? "WARNING" : "FAIL";
  const details: Record<CameraReadinessState, string> = {
    READY: "Camera access verified for this browser session",
    PERMISSION_REQUIRED: "Press Check Camera to verify permission and availability",
    PERMISSION_DENIED: "Allow camera permission in browser settings",
    NO_CAMERA_FOUND: "No usable video input was found",
    CAMERA_ERROR: "The camera could not be verified",
  };
  return { id: "camera", label: "Camera", status, value: camera.replaceAll("_", " "), detail: details[camera] };
}

export function evaluateReadiness(input: {
  role: Role;
  server: ServerReadiness;
  offline: OfflineSummary;
  serviceWorker: ServiceWorkerReadiness;
  camera: CameraReadinessState;
  offlineAuthorization: OfflineGrantStatus;
  now?: number;
}): ReadinessResult {
  const now = input.now ?? Date.now();
  const authorized = input.role === "ADMIN" || input.role === "PRIMARY_SCANNER";
  const hasSnapshot = Boolean(input.offline.lastSyncAt);
  const syncTime = input.offline.lastSyncAt ? Date.parse(input.offline.lastSyncAt) : Number.NaN;
  const cacheAge = Number.isFinite(syncTime) ? Math.max(0, now - syncTime) : Number.POSITIVE_INFINITY;
  const cacheFresh = hasSnapshot && cacheAge <= OFFLINE_CACHE_FRESHNESS_MS;
  const countsMatch = input.server.ticketCount !== null
    && input.offline.cachedTicketCount === input.server.ticketCount;
  const primaryGrantRequired = input.role === "PRIMARY_SCANNER";

  const grant = input.offlineAuthorization;
  const grantItem: ReadinessItem = grant.valid ? {
    id: "offline-authorization",
    label: "Offline Authorization",
    status: "PASS",
    value: "PRIMARY SCANNER GRANT",
    detail: `Valid until ${new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(grant.payload.exp * 1000))} · ${Math.ceil(grant.remainingSeconds / 3600)} hour${Math.ceil(grant.remainingSeconds / 3600) === 1 ? "" : "s"} remaining`,
  } : {
    id: "offline-authorization",
    label: "Offline Authorization",
    status: primaryGrantRequired ? "FAIL" : "WARNING",
    value: primaryGrantRequired ? grant.reason.replaceAll("_", " ") : "PRIMARY LOGIN REQUIRED",
    detail: primaryGrantRequired
      ? grant.detail
      : "Device-specific offline authorization can only be prepared while signed in as Primary Scanner",
  };

  const items: ReadinessItem[] = [
    {
      id: "role", label: "Authorized Role", status: authorized ? "PASS" : "FAIL",
      value: authorized ? "AUTHORIZED" : "NOT AUTHORIZED",
    },
    {
      id: "server", label: "Server Connection", status: input.server.reachable ? "PASS" : "FAIL",
      value: input.server.reachable ? "ONLINE" : "UNAVAILABLE", detail: input.server.error,
    },
    {
      id: "server-tickets", label: "Tickets on Server",
      status: input.server.ticketCount === null ? "FAIL" : "PASS",
      value: input.server.ticketCount === null ? "UNAVAILABLE" : String(input.server.ticketCount),
      detail: "Includes the same active and voided ticket set used by the offline scanner snapshot",
    },
    {
      id: "cached-tickets", label: "Tickets Cached Offline",
      status: hasSnapshot && countsMatch ? "PASS" : "FAIL",
      value: `${input.offline.cachedTicketCount} / ${input.server.ticketCount ?? "—"}`,
      detail: !hasSnapshot ? "No completed offline snapshot exists" : countsMatch ? undefined : "Cached and server ticket counts differ",
    },
    {
      id: "cache-freshness", label: "Offline Cache",
      status: !hasSnapshot ? "FAIL" : cacheFresh ? "PASS" : "WARNING",
      value: !hasSnapshot ? "MISSING" : cacheFresh ? "CURRENT" : "STALE",
      detail: !hasSnapshot
        ? "Refresh the offline cache"
        : `Last sync: ${Math.floor(cacheAge / 60_000)} minute${Math.floor(cacheAge / 60_000) === 1 ? "" : "s"} ago`,
    },
    {
      id: "pending", label: "Pending Offline Check-ins",
      status: input.offline.pendingCount === 0 ? "PASS" : "FAIL",
      value: String(input.offline.pendingCount),
      detail: input.offline.pendingCount > 0 ? `${input.offline.pendingCount} unsynchronized check-in${input.offline.pendingCount === 1 ? "" : "s"}` : undefined,
    },
    grantItem,
    {
      id: "service-worker", label: "Service Worker",
      status: input.serviceWorker.registered && input.serviceWorker.controlled ? "PASS" : "FAIL",
      value: input.serviceWorker.registered && input.serviceWorker.controlled ? "CONTROLLING" : "NOT CONTROLLING",
      detail: input.serviceWorker.detail,
    },
    {
      id: "app-shell", label: "App Shell",
      status: input.serviceWorker.shellCached ? "PASS" : "FAIL",
      value: input.serviceWorker.shellCached ? "CACHED" : "NOT CACHED",
      detail: input.serviceWorker.missing.length > 0 ? `Missing: ${input.serviceWorker.missing.join(", ")}` : undefined,
    },
    cameraItem(input.camera),
  ];

  const actions: string[] = [];
  if (!input.server.reachable || input.server.ticketCount === null) actions.push("Restore server connectivity and run the check again");
  if (!hasSnapshot || !countsMatch || !cacheFresh) actions.push("Refresh offline cache");
  if (input.offline.pendingCount > 0) actions.push(`Synchronize ${input.offline.pendingCount} pending check-in${input.offline.pendingCount === 1 ? "" : "s"}`);
  if (!grant.valid && primaryGrantRequired) actions.push("Prepare this device for offline use");
  if (!input.serviceWorker.registered || !input.serviceWorker.controlled) actions.push("Reload this page online so the Service Worker controls it");
  else if (!input.serviceWorker.shellCached) actions.push("Reload online to cache the application shell");
  if (input.camera !== "READY") actions.push("Check camera permission and availability");

  const requiredItems = primaryGrantRequired
    ? items
    : items.filter((item) => item.id !== "offline-authorization");
  return { ready: requiredItems.every((item) => item.status === "PASS"), items, actions: [...new Set(actions)] };
}
