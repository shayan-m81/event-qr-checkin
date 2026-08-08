import {
  acknowledgeOperations,
  getOfflineStorageEpoch,
  getOfflineSummary,
  getPendingOperations,
  getStoredOfflineGrant,
  removeStoredOfflineGrant,
  replaceOfflineSnapshot,
  storeOfflineGrant,
  type OfflineTicket,
} from "./offlineStore";
import { inspectStoredOfflineGrant, type OfflineGrantStatus } from "./offlineGrant";
import { requestWithTimeout } from "./request";

function isOfflineTicket(value: unknown): value is OfflineTicket {
  if (!value || typeof value !== "object") return false;
  const ticket = value as Partial<OfflineTicket>;
  return Number.isSafeInteger(ticket.ticketId)
    && typeof ticket.token === "string"
    && typeof ticket.guestName === "string"
    && typeof ticket.ticketType === "string"
    && (ticket.voidedAt === null || typeof ticket.voidedAt === "string")
    && (ticket.checkedInAt === null || typeof ticket.checkedInAt === "string");
}

export async function refreshOfflineSnapshot(): Promise<number> {
  const storageEpoch = getOfflineStorageEpoch();
  const response = await requestWithTimeout("/api/offline/snapshot", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  const data = await response.json() as { generatedAt?: unknown; tickets?: unknown };
  if (typeof data.generatedAt !== "string" || Number.isNaN(Date.parse(data.generatedAt))
    || !Array.isArray(data.tickets) || !data.tickets.every(isOfflineTicket)) {
    throw new Error("Invalid snapshot response");
  }
  await replaceOfflineSnapshot(data.tickets, data.generatedAt, storageEpoch);
  return data.tickets.length;
}

export async function prepareOfflineDevice(
  verifyStoredGrant: () => Promise<OfflineGrantStatus> = inspectStoredOfflineGrant,
): Promise<OfflineGrantStatus & { valid: true }> {
  const summary = await getOfflineSummary();
  if (summary.pendingCount > 0) {
    throw new Error(`Synchronize ${summary.pendingCount} pending offline check-in${summary.pendingCount === 1 ? "" : "s"} before preparing this device`);
  }
  await refreshOfflineSnapshot();
  const response = await requestWithTimeout("/api/offline/grant", { method: "POST" });
  if (!response.ok) throw new Error(`Offline grant request failed with HTTP ${response.status}`);
  const data = await response.json() as { grant?: unknown };
  if (typeof data.grant !== "string") throw new Error("Invalid offline grant response");

  const previousGrant = await getStoredOfflineGrant();
  await storeOfflineGrant(data.grant);
  const verified = await verifyStoredGrant();
  if (!verified.valid) {
    if (previousGrant) await storeOfflineGrant(previousGrant);
    else await removeStoredOfflineGrant();
    throw new Error(verified.detail);
  }
  return verified;
}

export async function synchronizePendingOperations(): Promise<{
  acknowledged: number;
  conflicts: number;
}> {
  const storageEpoch = getOfflineStorageEpoch();
  const operations = await getPendingOperations();
  if (operations.length === 0) return { acknowledged: 0, conflicts: 0 };
  const response = await requestWithTimeout("/api/offline/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations }),
  });
  if (!response.ok) throw new Error(`Synchronization request failed with HTTP ${response.status}`);
  const data = await response.json() as {
    results: Array<{
      clientOperationId: string;
      acknowledged: boolean;
      outcome: "APPLIED" | "IDEMPOTENT_REPLAY" | "CONFLICT" | "INVALID" | "VOIDED";
      guestName?: string;
      checkedInAt?: string;
    }>;
  };
  const allowedOutcomes = ["APPLIED", "IDEMPOTENT_REPLAY", "CONFLICT", "INVALID", "VOIDED"];
  const operationIds = new Set(operations.map((operation) => operation.clientOperationId));
  if (!Array.isArray(data.results)
    || data.results.some((result) => !result
      || typeof result.clientOperationId !== "string"
      || !operationIds.has(result.clientOperationId)
      || typeof result.acknowledged !== "boolean"
      || !allowedOutcomes.includes(result.outcome))) {
    throw new Error("Invalid synchronization response");
  }
  await acknowledgeOperations(data.results, storageEpoch);
  return {
    acknowledged: data.results.filter((result) => result.acknowledged).length,
    conflicts: data.results.filter((result) => result.outcome === "CONFLICT").length,
  };
}
