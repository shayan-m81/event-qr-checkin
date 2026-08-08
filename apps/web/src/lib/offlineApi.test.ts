import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareOfflineDevice, refreshOfflineSnapshot, synchronizePendingOperations } from "./offlineApi";
import { checkInOffline, deleteOfflineDatabaseForTests, getOfflineSummary, getStoredOfflineGrant, replaceOfflineSnapshot, storeOfflineGrant } from "./offlineStore";

beforeEach(async () => deleteOfflineDatabaseForTests());

describe("offline synchronization client", () => {
  it("submits persisted operations and removes only server acknowledgements", async () => {
    const token = "pt_maya1234567890123456789012345678";
    await replaceOfflineSnapshot([{ ticketId: 1, token, guestName: "Maya", ticketType: "VIP", voidedAt: null, checkedInAt: null }], new Date().toISOString());
    const local = await checkInOffline(token);
    if (local.state !== "VALID") throw new Error("Expected offline check-in");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{
      clientOperationId: local.operation.clientOperationId,
      acknowledged: true,
      outcome: "APPLIED",
      checkedInAt: local.operation.checkedInAt,
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(synchronizePendingOperations()).resolves.toEqual({ acknowledged: 1, conflicts: 0 });
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 0 });
  });

  it("retains pending work across a failed request and synchronizes after reconnection", async () => {
    const token = "pt_retry1234567890123456789012345678";
    await replaceOfflineSnapshot([{ ticketId: 2, token, guestName: "Noah", ticketType: "General", voidedAt: null, checkedInAt: null }], new Date().toISOString());
    const local = await checkInOffline(token);
    if (local.state !== "VALID") throw new Error("Expected offline check-in");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{
        clientOperationId: local.operation.clientOperationId,
        acknowledged: true,
        outcome: "IDEMPOTENT_REPLAY",
      }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(synchronizePendingOperations()).rejects.toThrow("network unavailable");
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 1 });
    await expect(synchronizePendingOperations()).resolves.toEqual({ acknowledged: 1, conflicts: 0 });
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 0 });
  });

  it("rejects an unrecognized acknowledgement without deleting pending work", async () => {
    const token = "pt_unknownack1234567890123456789012";
    await replaceOfflineSnapshot([{ ticketId: 3, token, guestName: "Vera", ticketType: "VIP", voidedAt: null, checkedInAt: null }], new Date().toISOString());
    await checkInOffline(token);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{
      clientOperationId: "operation_not_sent_123456",
      acknowledged: true,
      outcome: "APPLIED",
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(synchronizePendingOperations()).rejects.toThrow("Invalid synchronization response");
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 1 });
  });

  it("keeps the previous usable snapshot when a refresh request fails", async () => {
    const existing = [{
      ticketId: 8, token: "pt_preserve123456789012345678901234", guestName: "Existing",
      ticketType: "VIP", voidedAt: null, checkedInAt: null,
    }];
    await replaceOfflineSnapshot(existing, "2026-08-08T19:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
    await expect(refreshOfflineSnapshot()).rejects.toThrow("network unavailable");
    await expect(getOfflineSummary()).resolves.toMatchObject({ cachedTicketCount: 1, lastSyncAt: "2026-08-08T19:00:00.000Z" });
  });

  it("persists a freshly issued grant after local verification", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ generatedAt: new Date().toISOString(), tickets: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ grant: "new.signed-grant" }), { status: 200 })));
    const verified = {
      valid: true as const, grant: "new.signed-grant", remainingSeconds: 3600,
      payload: { v: 1 as const, type: "offline_scanner_grant" as const, role: "PRIMARY_SCANNER" as const,
        scope: "party-check-in" as const, iat: 1, exp: 9999999999, jti: "prepared-grant-id-123" },
    };
    await expect(prepareOfflineDevice(async () => verified)).resolves.toEqual(verified);
    await expect(getStoredOfflineGrant()).resolves.toBe("new.signed-grant");
  });

  it("restores the prior grant when new local verification fails", async () => {
    await storeOfflineGrant("previous.signed-grant");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ generatedAt: new Date().toISOString(), tickets: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ grant: "bad.signed-grant" }), { status: 200 })));
    await expect(prepareOfflineDevice(async () => ({ valid: false, reason: "INVALID_SIGNATURE", detail: "Invalid signature" }))).rejects.toThrow("Invalid signature");
    await expect(getStoredOfflineGrant()).resolves.toBe("previous.signed-grant");
  });

  it("refuses preparation while pending offline check-ins exist", async () => {
    const token = "pt_preparepending123456789012345678901";
    await replaceOfflineSnapshot([{ ticketId: 44, token, guestName: "Pending", ticketType: "VIP", voidedAt: null, checkedInAt: null }], new Date().toISOString());
    await checkInOffline(token);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(prepareOfflineDevice()).rejects.toThrow("Synchronize 1 pending offline check-in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
