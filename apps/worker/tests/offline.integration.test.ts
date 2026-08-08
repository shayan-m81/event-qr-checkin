import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

const integrationEnv = env as unknown as Env;
const token = "pt_offline12345678901234567890123456";

async function cookie(role: Role): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, integrationEnv.SESSION_SECRET)}`;
}

async function api(path: string, role: Role, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await cookie(role));
  if (init.method === "POST") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), integrationEnv);
}

function operation(clientOperationId = "offline_operation_1234567890") {
  return { clientOperationId, token, checkedInAt: "2026-08-08T20:00:00.000Z" };
}

beforeEach(async () => {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare("DELETE FROM offline_conflicts"),
    integrationEnv.DB.prepare("DELETE FROM checkins"),
    integrationEnv.DB.prepare("DELETE FROM tickets"),
    integrationEnv.DB.prepare("INSERT INTO tickets (token, guest_name, ticket_type) VALUES (?, 'Maya Chen', 'VIP')").bind(token),
  ]);
});

describe("emergency offline APIs", () => {
  it("creates a primary-only snapshot with known check-in state", async () => {
    const response = await api("/api/offline/snapshot", "PRIMARY_SCANNER");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tickets: [{ token, guestName: "Maya Chen", checkedInAt: null }] });
    expect((await api("/api/offline/snapshot", "SECONDARY_SCANNER")).status).toBe(403);
    expect((await api("/api/offline/snapshot", "ADMIN")).status).toBe(200);
  });

  it("reports the readiness ticket count to ADMIN and PRIMARY only", async () => {
    const primary = await api("/api/readiness/status", "PRIMARY_SCANNER");
    await expect(primary.json()).resolves.toMatchObject({ ticketCount: 1 });
    expect((await api("/api/readiness/status", "ADMIN")).status).toBe(200);
    expect((await api("/api/readiness/status", "SECONDARY_SCANNER")).status).toBe(403);
  });

  it("synchronizes an offline check-in through the shared D1 constraint", async () => {
    const response = await api("/api/offline/sync", "PRIMARY_SCANNER", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [operation()] }),
    });
    await expect(response.json()).resolves.toMatchObject({ results: [{ acknowledged: true, outcome: "APPLIED" }] });
    const row = await integrationEnv.DB.prepare("SELECT source, client_operation_id FROM checkins").first<{ source: string; client_operation_id: string }>();
    expect(row).toEqual({ source: "OFFLINE", client_operation_id: operation().clientOperationId });
  });

  it("acknowledges an idempotent retry without creating another check-in", async () => {
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [operation()] }) };
    await api("/api/offline/sync", "PRIMARY_SCANNER", init);
    await expect((await api("/api/offline/sync", "PRIMARY_SCANNER", init)).json())
      .resolves.toMatchObject({ results: [{ acknowledged: true, outcome: "IDEMPOTENT_REPLAY" }] });
    const count = await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM checkins").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("records a server duplicate as a conflict exposed only to ADMIN", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ticket = await integrationEnv.DB.prepare("SELECT id FROM tickets WHERE token = ?").bind(token).first<{ id: number }>();
    await integrationEnv.DB.prepare("INSERT INTO checkins (ticket_id, scanner_role, source) VALUES (?, 'SECONDARY_SCANNER', 'QR')").bind(ticket!.id).run();
    const sync = await api("/api/offline/sync", "PRIMARY_SCANNER", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [operation()] }),
    });
    await expect(sync.json()).resolves.toMatchObject({ results: [{ acknowledged: true, outcome: "CONFLICT", guestName: "Maya Chen" }] });
    const admin = await api("/api/offline/conflicts", "ADMIN");
    await expect(admin.json()).resolves.toMatchObject({ conflicts: [{ guest_name: "Maya Chen", client_operation_id: operation().clientOperationId }] });
    expect((await api("/api/offline/conflicts", "PRIMARY_SCANNER")).status).toBe(403);
    const logOutput = warning.mock.calls.flat().join(" ");
    expect(logOutput).toContain('"event":"offline_sync_conflict"');
    expect(logOutput).not.toContain(token);
    warning.mockRestore();
  });

  it("does not allow one idempotency key to acknowledge a different ticket", async () => {
    const otherToken = "pt_other123456789012345678901234567";
    await integrationEnv.DB.prepare("INSERT INTO tickets (token, guest_name, ticket_type) VALUES (?, 'Noah Williams', 'VIP')").bind(otherToken).run();
    const clientOperationId = "offline_operation_collision_123";
    const request = (operationToken: string) => api("/api/offline/sync", "PRIMARY_SCANNER", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: [{ ...operation(clientOperationId), token: operationToken }] }),
    });
    await expect((await request(token)).json()).resolves.toMatchObject({ results: [{ outcome: "APPLIED" }] });
    await expect((await request(otherToken)).json()).resolves.toMatchObject({ results: [{ outcome: "INVALID" }] });
    const count = await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM checkins").first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("locks secondary scanners out of synchronization and rejects malformed batches", async () => {
    const body = JSON.stringify({ operations: [operation()] });
    expect((await api("/api/offline/sync", "SECONDARY_SCANNER", { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(403);
    expect((await api("/api/offline/sync", "PRIMARY_SCANNER", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [] }) })).status).toBe(400);
    expect((await api("/api/offline/sync", "PRIMARY_SCANNER", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations: [operation(), operation()] }),
    })).status).toBe(400);
  });
});
