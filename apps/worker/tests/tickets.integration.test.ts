import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

const integrationEnv = env as unknown as Env;

async function roleCookie(role: Role): Promise<string> {
  const token = await createSessionToken(role, integrationEnv.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function roleRequest(path: string, role: Role, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await roleCookie(role));
  if (init.method && init.method !== "GET") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), integrationEnv);
}

function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  return roleRequest(path, "ADMIN", init);
}

async function createTicket(ticketType = "VIP") {
  const response = await adminRequest("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestName: "Maya Chen", refereeName: "Sam Rivera", ticketType }),
  });
  return response.json() as Promise<{
    ticket: {
      id: number;
      token: string;
      guestName: string;
      refereeName: string;
      ticketType: string;
      createdAt: string;
      voidedAt: string | null;
    };
  }>;
}

beforeEach(async () => {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare("DELETE FROM checkins"),
    integrationEnv.DB.prepare("DELETE FROM tickets"),
  ]);
});

describe("ticket referee persistence", () => {
  it("creates, stores, and lists normalized referee names through D1", async () => {
    const created = await adminRequest("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: "Maya Chen",
        refereeName: "  Sam   Rivera  ",
        ticketType: "VIP",
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      ticket: { guestName: "Maya Chen", refereeName: "Sam Rivera", ticketType: "VIP" },
    });

    const stored = await integrationEnv.DB.prepare(`
      SELECT referee_name FROM tickets WHERE guest_name = ?
    `).bind("Maya Chen").first<{ referee_name: string }>();
    expect(stored?.referee_name).toBe("Sam Rivera");

    const listed = await adminRequest("/api/tickets");
    await expect(listed.json()).resolves.toMatchObject({
      tickets: [{ guestName: "Maya Chen", refereeName: "Sam Rivera" }],
      refereeNames: ["Sam Rivera"],
    });
  });
});

describe("ticket editing", () => {
  it("normalizes corrections while preserving ticket identity and creation state", async () => {
    const original = (await createTicket()).ticket;
    const response = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestName: "  Maia   Chen ",
        refereeName: "  Sara   Rivera ",
        ticketType: "General admission",
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ticket: {
        id: original.id,
        token: original.token,
        guestName: "Maia Chen",
        refereeName: "Sara Rivera",
        ticketType: "General admission",
        createdAt: original.createdAt,
        voidedAt: null,
      },
    });
  });

  it("allows text corrections but locks ticket type after check-in", async () => {
    const original = (await createTicket("VIP")).ticket;
    await integrationEnv.DB.prepare(`
      INSERT INTO checkins (ticket_id, scanner_role, source)
      VALUES (?, 'ADMIN', 'MANUAL')
    `).bind(original.id).run();

    const textCorrection = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chan", refereeName: "Sara Rivera", ticketType: "VIP" }),
    });
    await expect(textCorrection.json()).resolves.toMatchObject({
      ticket: { guestName: "Maya Chan", refereeName: "Sara Rivera", ticketType: "VIP" },
    });

    const typeChange = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chan", refereeName: "Sara Rivera", ticketType: "General admission" }),
    });
    expect(typeChange.status).toBe(409);
    await expect(typeChange.json()).resolves.toMatchObject({ error: "ticket_type_locked" });
  });

  it("edits cancelled ticket metadata without restoring it", async () => {
    const original = (await createTicket()).ticket;
    await adminRequest(`/api/tickets/${original.id}/cancel`, { method: "POST" });
    const response = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chan", refereeName: "Sam Rivera", ticketType: "VIP" }),
    });
    const body = await response.json() as { ticket: { voidedAt: string | null } };
    expect(body.ticket.voidedAt).toBeTruthy();
  });

  it.each<Role>(["PRIMARY_SCANNER", "SECONDARY_SCANNER"])("rejects edits by %s", async (role) => {
    const original = (await createTicket()).ticket;
    const response = await roleRequest(`/api/tickets/${original.id}`, role, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chan", refereeName: "Sam Rivera", ticketType: "VIP" }),
    });
    expect(response.status).toBe(403);
  });

  it("validates edit bodies and missing tickets", async () => {
    const original = (await createTicket()).ticket;
    const invalid = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "", refereeName: "Sam Rivera", ticketType: "VIP" }),
    });
    await expect(invalid.json()).resolves.toEqual({ error: "invalid_guest_name" });

    const malformed = await adminRequest(`/api/tickets/${original.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    await expect(malformed.json()).resolves.toEqual({ error: "invalid_request" });

    const missing = await adminRequest("/api/tickets/999999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chan", refereeName: "Sam Rivera", ticketType: "VIP" }),
    });
    expect(missing.status).toBe(404);
  });
});
