import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeOperations,
  checkInOffline,
  deleteOfflineDatabaseForTests,
  clearOfflineDatabase,
  getOfflineStorageEpoch,
  getOfflineSummary,
  getPendingOperations,
  getStoredOfflineGrant,
  removeOfflineAuthorization,
  replaceOfflineSnapshot,
  setOfflineModeEnabled,
  storeOfflineGrant,
  type OfflineTicket,
} from "./offlineStore";

const snapshot: OfflineTicket[] = [
  { ticketId: 1, token: "pt_maya1234567890123456789012345678", guestName: "Maya Chen", ticketType: "VIP", voidedAt: null, checkedInAt: null },
  { ticketId: 2, token: "pt_used1234567890123456789012345678", guestName: "Noah Williams", ticketType: "General", voidedAt: null, checkedInAt: "2026-08-08T18:00:00.000Z" },
  { ticketId: 3, token: "pt_void1234567890123456789012345678", guestName: "Vera Void", ticketType: "VIP", voidedAt: "2026-08-08T17:00:00.000Z", checkedInAt: null },
];

beforeEach(async () => deleteOfflineDatabaseForTests());

describe("emergency offline IndexedDB state", () => {
  it("creates and persists a complete ticket snapshot", async () => {
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z");
    await expect(getOfflineSummary()).resolves.toEqual({
      cachedTicketCount: 3, pendingCount: 0, conflictCount: 0, lastSyncAt: "2026-08-08T19:00:00.000Z",
    });
    await expect(getOfflineSummary()).resolves.toMatchObject({ cachedTicketCount: 3 });
  });

  it("persists a valid offline scan and rejects a local duplicate", async () => {
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z");
    const first = await checkInOffline(snapshot[0].token, "2026-08-08T20:00:00.000Z");
    expect(first.state).toBe("VALID");
    const operationsAfterReload = await getPendingOperations();
    expect(operationsAfterReload).toHaveLength(1);
    expect(operationsAfterReload[0]).toMatchObject({ token: snapshot[0].token, checkedInAt: "2026-08-08T20:00:00.000Z" });
    await expect(checkInOffline(snapshot[0].token)).resolves.toMatchObject({ state: "ALREADY_USED" });
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 1 });
  });

  it("rejects a cancelled ticket from the refreshed snapshot without queuing a check-in", async () => {
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z");
    await expect(checkInOffline(snapshot[2].token)).resolves.toMatchObject({
      state: "VOIDED",
      ticket: { guestName: "Vera Void", voidedAt: "2026-08-08T17:00:00.000Z" },
    });
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 0 });
  });

  it("retains rejected acknowledgements as visible local conflicts while removing pending work", async () => {
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z");
    const first = await checkInOffline(snapshot[0].token);
    if (first.state !== "VALID") throw new Error("Expected valid check-in");
    await acknowledgeOperations([{
      clientOperationId: first.operation.clientOperationId,
      acknowledged: true,
      outcome: "CONFLICT",
      guestName: "Maya Chen",
      checkedInAt: "2026-08-08T19:30:00.000Z",
    }]);
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 0, conflictCount: 1 });
  });

  it("prevents an in-flight pre-logout snapshot from repopulating cleared data", async () => {
    const requestEpoch = getOfflineStorageEpoch();
    await clearOfflineDatabase();
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z", requestEpoch);
    await expect(getOfflineSummary()).resolves.toMatchObject({ cachedTicketCount: 0, pendingCount: 0 });
  });

  it("persists the grant across database reopen and removes authorization without deleting pending work", async () => {
    await replaceOfflineSnapshot(snapshot, "2026-08-08T19:00:00.000Z");
    await checkInOffline(snapshot[0].token);
    await storeOfflineGrant("signed.offline-grant");
    await setOfflineModeEnabled(true);
    await expect(getStoredOfflineGrant()).resolves.toBe("signed.offline-grant");
    await removeOfflineAuthorization();
    await expect(getStoredOfflineGrant()).resolves.toBeNull();
    await expect(getOfflineSummary()).resolves.toMatchObject({ cachedTicketCount: 3, pendingCount: 1 });
  });

});
