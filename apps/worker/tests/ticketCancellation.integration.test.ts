import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

const integrationEnv = env as unknown as Env;
const ticketToken = "pt_cancel12345678901234567890123456";

async function cookie(role: Role): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await createSessionToken(role, integrationEnv.SESSION_SECRET)}`;
}

async function api(path: string, role: Role, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await cookie(role));
  if (init.method === "POST") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), integrationEnv);
}

async function ticket(): Promise<{ id: number; token: string; voided_at: string | null }> {
  const row = await integrationEnv.DB.prepare("SELECT id, token, voided_at FROM tickets WHERE token = ?")
    .bind(ticketToken).first<{ id: number; token: string; voided_at: string | null }>();
  if (!row) throw new Error("Missing cancellation test ticket");
  return row;
}

beforeEach(async () => {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare("DELETE FROM checkins"),
    integrationEnv.DB.prepare("DELETE FROM tickets"),
    integrationEnv.DB.prepare(`
      INSERT INTO tickets (token, guest_name, ticket_type)
      VALUES (?, 'Casey Cancel', 'VIP')
    `).bind(ticketToken),
  ]);
});

describe("simple ticket cancellation", () => {
  it("allows ADMIN to cancel without deleting or replacing the ticket and is idempotent", async () => {
    const original = await ticket();
    const first = await api(`/api/tickets/${original.id}/cancel`, "ADMIN", { method: "POST" });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { ticket: { token: string; voidedAt: string } };
    expect(firstBody.ticket).toMatchObject({ token: original.token });
    expect(firstBody.ticket.voidedAt).toBeTruthy();

    const second = await api(`/api/tickets/${original.id}/cancel`, "ADMIN", { method: "POST" });
    await expect(second.json()).resolves.toMatchObject({
      ticket: { token: original.token, voidedAt: firstBody.ticket.voidedAt },
    });
    await expect(ticket()).resolves.toMatchObject({ id: original.id, token: original.token, voided_at: firstBody.ticket.voidedAt });
  });

  it.each<Role>(["PRIMARY_SCANNER", "SECONDARY_SCANNER"])("rejects cancellation by %s", async (role) => {
    const current = await ticket();
    expect((await api(`/api/tickets/${current.id}/cancel`, role, { method: "POST" })).status).toBe(403);
    expect((await api(`/api/tickets/${current.id}/restore`, role, { method: "POST" })).status).toBe(403);
    await expect(ticket()).resolves.toMatchObject({ voided_at: null });
  });

  it("keeps the cancelled ticket visible and rejects QR and manual check-in", async () => {
    const current = await ticket();
    await api(`/api/tickets/${current.id}/cancel`, "ADMIN", { method: "POST" });

    await expect((await api("/api/guests?query=Casey", "PRIMARY_SCANNER")).json()).resolves.toMatchObject({
      guests: [{ ticketId: current.id, status: "CANCELLED" }],
    });
    const qr = await api("/api/checkin", "PRIMARY_SCANNER", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ticketToken }),
    });
    await expect(qr.json()).resolves.toMatchObject({ state: "VOIDED", guestName: "Casey Cancel" });
    await expect((await api(`/api/guests/${current.id}/checkin`, "ADMIN", { method: "POST" })).json())
      .resolves.toMatchObject({ state: "VOIDED", guestName: "Casey Cancel" });
    const count = await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM checkins")
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("restores an unchecked ticket with its original token", async () => {
    const original = await ticket();
    await api(`/api/tickets/${original.id}/cancel`, "ADMIN", { method: "POST" });
    const restored = await api(`/api/tickets/${original.id}/restore`, "ADMIN", { method: "POST" });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      ticket: { id: original.id, token: original.token, voidedAt: null },
    });
    await expect(ticket()).resolves.toMatchObject({ id: original.id, token: original.token, voided_at: null });
  });

  it("refuses to restore a ticket that previously checked in", async () => {
    const original = await ticket();
    await api("/api/checkin", "ADMIN", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ticketToken }),
    });
    await api(`/api/tickets/${original.id}/cancel`, "ADMIN", { method: "POST" });

    const restored = await api(`/api/tickets/${original.id}/restore`, "ADMIN", { method: "POST" });
    expect(restored.status).toBe(409);
    await expect(restored.json()).resolves.toMatchObject({ error: "ticket_already_checked_in" });
    expect((await ticket()).voided_at).toBeTruthy();
  });
});
