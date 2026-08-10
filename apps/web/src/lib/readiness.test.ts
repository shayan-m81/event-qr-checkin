import { describe, expect, it } from "vitest";
import { OFFLINE_CACHE_FRESHNESS_MS } from "../config/readiness";
import { evaluateReadiness } from "./readiness";

const now = Date.parse("2026-08-08T20:00:00.000Z");
const readyInput = {
  role: "PRIMARY_SCANNER" as const,
  server: { reachable: true, ticketCount: 347 },
  offline: { cachedTicketCount: 347, pendingCount: 0, conflictCount: 0, lastSyncAt: new Date(now - 60_000).toISOString() },
  serviceWorker: { registered: true, controlled: true, shellCached: true, missing: [] },
  camera: "READY" as const,
  offlineAuthorization: {
    valid: true as const,
    grant: "test-grant",
    remainingSeconds: 11 * 60 * 60,
    payload: {
      v: 1 as const, type: "offline_scanner_grant" as const, role: "PRIMARY_SCANNER" as const,
      scope: "party-check-in" as const, iat: Math.floor(now / 1000) - 3600,
      exp: Math.floor(now / 1000) + 11 * 60 * 60, jti: "test-grant-identifier-123",
    },
  },
  now,
};

describe("event readiness evaluation", () => {
  it("passes only when every required condition passes", () => {
    const result = evaluateReadiness(readyInput);
    expect(result.ready).toBe(true);
    expect(result.items.every((item) => item.status === "PASS")).toBe(true);
  });

  it("fails when the API is unavailable", () => {
    const result = evaluateReadiness({ ...readyInput, server: { reachable: false, ticketCount: null, error: "offline" } });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "server")).toMatchObject({ status: "FAIL", value: "UNAVAILABLE" });
  });

  it("fails when server and cached ticket counts differ", () => {
    const result = evaluateReadiness({ ...readyInput, offline: { ...readyInput.offline, cachedTicketCount: 346 } });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "cached-tickets")).toMatchObject({ status: "FAIL", value: "346 / 347" });
  });

  it("warns and withholds ready when the cache is older than thirty minutes", () => {
    const result = evaluateReadiness({
      ...readyInput,
      offline: { ...readyInput.offline, lastSyncAt: new Date(now - OFFLINE_CACHE_FRESHNESS_MS - 1).toISOString() },
    });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "cache-freshness")).toMatchObject({ status: "WARNING", value: "STALE" });
  });

  it("fails when pending offline work exists", () => {
    const result = evaluateReadiness({ ...readyInput, offline: { ...readyInput.offline, pendingCount: 3 } });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "pending")).toMatchObject({ status: "FAIL", value: "3" });
  });

  it("fails when Primary offline authorization is missing", () => {
    const result = evaluateReadiness({
      ...readyInput,
      offlineAuthorization: { valid: false, reason: "MISSING", detail: "No offline grant prepared" },
    });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "offline-authorization")).toMatchObject({ status: "FAIL" });
  });

  it("lets ADMIN inspect readiness without receiving or requiring a Primary grant", () => {
    const result = evaluateReadiness({
      ...readyInput,
      role: "ADMIN",
      offlineAuthorization: { valid: false, reason: "MISSING", detail: "No offline grant prepared" },
    });
    expect(result.ready).toBe(true);
    expect(result.items.find((item) => item.id === "offline-authorization")).toMatchObject({
      status: "WARNING",
      value: "PRIMARY LOGIN REQUIRED",
    });
    expect(result.actions).not.toContain("Prepare this device for offline use");
  });

  it("fails when the Service Worker or app shell is unavailable", () => {
    const result = evaluateReadiness({
      ...readyInput,
      serviceWorker: { registered: true, controlled: true, shellCached: false, missing: ["/assets/app.js"] },
    });
    expect(result.ready).toBe(false);
    expect(result.items.find((item) => item.id === "app-shell")).toMatchObject({ status: "FAIL" });
  });

  it("treats camera permission as a warning and camera errors as failures", () => {
    const permission = evaluateReadiness({ ...readyInput, camera: "PERMISSION_REQUIRED" });
    expect(permission.ready).toBe(false);
    expect(permission.items.find((item) => item.id === "camera")?.status).toBe("WARNING");
    const denied = evaluateReadiness({ ...readyInput, camera: "PERMISSION_DENIED" });
    expect(denied.items.find((item) => item.id === "camera")?.status).toBe("FAIL");
  });
});
