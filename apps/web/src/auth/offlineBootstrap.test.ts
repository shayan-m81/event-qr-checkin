import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeOfflinePrimary } from "./offlineBootstrap";
import { inspectStoredOfflineGrant } from "../lib/offlineGrant";
import { getOfflineSummary } from "../lib/offlineStore";
import { checkServiceWorkerReadiness } from "../lib/serviceWorkerReadiness";

vi.mock("../lib/offlineGrant", () => ({ inspectStoredOfflineGrant: vi.fn() }));
vi.mock("../lib/offlineStore", () => ({ getOfflineSummary: vi.fn() }));
vi.mock("../lib/serviceWorkerReadiness", () => ({ checkServiceWorkerReadiness: vi.fn() }));

const grant = {
  valid: true as const,
  grant: "signed",
  remainingSeconds: 3600,
  payload: {
    v: 1 as const, type: "offline_scanner_grant" as const, role: "PRIMARY_SCANNER" as const,
    scope: "party-check-in" as const, iat: 1, exp: 9999999999, jti: "bootstrap-grant-id-123",
  },
};

beforeEach(() => {
  vi.mocked(inspectStoredOfflineGrant).mockResolvedValue(grant);
  vi.mocked(getOfflineSummary).mockResolvedValue({ cachedTicketCount: 10, pendingCount: 0, conflictCount: 0, lastSyncAt: new Date().toISOString() });
  vi.mocked(checkServiceWorkerReadiness).mockResolvedValue({ registered: true, controlled: true, shellCached: true, missing: [] });
});

describe("offline Primary bootstrap prerequisites", () => {
  it("authorizes only when grant, snapshot, Service Worker, and shell are ready", async () => {
    await expect(authorizeOfflinePrimary()).resolves.toMatchObject({ authorized: true, grant: { role: "PRIMARY_SCANNER" } });
  });

  it("fails closed when no valid grant exists", async () => {
    vi.mocked(inspectStoredOfflineGrant).mockResolvedValue({ valid: false, reason: "MISSING", detail: "No offline grant prepared" });
    await expect(authorizeOfflinePrimary()).resolves.toEqual({ authorized: false, reason: "No offline grant prepared" });
  });

  it("fails closed without a snapshot", async () => {
    vi.mocked(getOfflineSummary).mockResolvedValue({ cachedTicketCount: 0, pendingCount: 0, conflictCount: 0, lastSyncAt: null });
    await expect(authorizeOfflinePrimary()).resolves.toEqual({ authorized: false, reason: "No offline ticket snapshot is prepared" });
  });

  it("fails closed without a controlling, complete shell", async () => {
    vi.mocked(checkServiceWorkerReadiness).mockResolvedValue({ registered: true, controlled: true, shellCached: false, missing: ["/assets/scanner.js"] });
    await expect(authorizeOfflinePrimary()).resolves.toMatchObject({ authorized: false, reason: expect.stringContaining("scanner.js") });
  });
});
