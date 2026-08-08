import { describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import { generateTicketToken } from "../src/tickets";
import type { Env, Role } from "../src/types";

type StoredTicket = {
  id: number;
  token: string;
  guest_name: string;
  ticket_type: string;
  created_at: string;
  voided_at: string | null;
};

class MemoryTicketDatabase {
  tickets: StoredTicket[] = [];

  prepare(query: string) {
    const database = this;
    let values: unknown[] = [];
    const normalized = query.replace(/\s+/g, " ").trim().toUpperCase();
    const statement = {
      bind(...boundValues: unknown[]) {
        values = boundValues;
        return statement;
      },
      async first<T>(): Promise<T | null> {
        if (normalized.startsWith("INSERT OR IGNORE INTO TICKETS")) {
          const [token, guestName, ticketType] = values as [string, string, string];
          if (database.tickets.some((ticket) => ticket.token === token)) return null;
          const ticket: StoredTicket = {
            id: database.tickets.length + 1,
            token,
            guest_name: guestName,
            ticket_type: ticketType,
            created_at: `2026-08-07T20:00:0${database.tickets.length}.000Z`,
            voided_at: null,
          };
          database.tickets.push(ticket);
          return ticket as T;
        }
        if (normalized.startsWith("UPDATE TICKETS")) {
          const id = Number(values[0]);
          const ticket = database.tickets.find((item) => item.id === id);
          if (!ticket) return null;
          ticket.voided_at ??= "2026-08-07T21:00:00.000Z";
          return ticket as T;
        }
        if (normalized.includes("FROM TICKETS") && normalized.includes("WHERE ID = ?")) {
          return (database.tickets.find((ticket) => ticket.id === Number(values[0])) ?? null) as T | null;
        }
        throw new Error(`Unsupported first query: ${normalized}`);
      },
      async all<T>() {
        if (!normalized.includes("FROM TICKETS")) throw new Error(`Unsupported all query: ${normalized}`);
        return { results: [...database.tickets].reverse() as T[], success: true, meta: {} };
      },
    };
    return statement;
  }
}

const secrets = {
  ADMIN_ACCESS_CODE: "admin-test-access-code",
  PRIMARY_SCANNER_ACCESS_CODE: "primary-test-access-code",
  SECONDARY_SCANNER_ACCESS_CODE: "secondary-test-access-code",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  OFFLINE_GRANT_PRIVATE_KEY: "unused-by-ticket-tests",
};

function testEnv(database = new MemoryTicketDatabase()): Env {
  return {
    ...secrets,
    DB: database as unknown as D1Database,
    ASSETS: { fetch: () => Promise.resolve(new Response("asset")) } as unknown as Fetcher,
  };
}

async function roleCookie(role: Role): Promise<string> {
  const token = await createSessionToken(role, secrets.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function apiRequest(
  env: Env,
  path: string,
  role: Role | null,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (role) headers.set("Cookie", await roleCookie(role));
  if (init.method === "POST") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), env);
}

describe("ticket tokens", () => {
  it("uses 192 bits of random input with the recognizable opaque format", () => {
    const tokens = Array.from({ length: 512 }, generateTicketToken);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) expect(token).toMatch(/^pt_[A-Za-z0-9_-]{32}$/);
  });
});

describe("ticket API", () => {
  it("creates and stores a normalized ticket as ADMIN", async () => {
    const database = new MemoryTicketDatabase();
    const response = await apiRequest(testEnv(database), "/api/tickets", "ADMIN", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "  Maya   Chen ", ticketType: "VIP" }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { ticket: { guestName: string; token: string } };
    expect(body.ticket.guestName).toBe("Maya Chen");
    expect(body.ticket.token).toMatch(/^pt_[A-Za-z0-9_-]{32}$/);
    expect(body.ticket.token).not.toContain("Maya");
    expect(database.tickets).toHaveLength(1);
  });

  it.each([
    [{ guestName: "", ticketType: "VIP" }, "invalid_guest_name"],
    [{ guestName: "x".repeat(121), ticketType: "VIP" }, "invalid_guest_name"],
    [{ guestName: "Maya Chen", ticketType: "Backstage" }, "invalid_ticket_type"],
  ])("validates creation input", async (input, error) => {
    const response = await apiRequest(testEnv(), "/api/tickets", "ADMIN", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("requires an ADMIN session for every ticket operation", async () => {
    const env = testEnv();
    expect((await apiRequest(env, "/api/tickets", null)).status).toBe(401);
    expect((await apiRequest(env, "/api/tickets", "PRIMARY_SCANNER")).status).toBe(403);
    expect((await apiRequest(env, "/api/tickets/1", "SECONDARY_SCANNER")).status).toBe(403);
    expect((await apiRequest(env, "/api/tickets/1/cancel", "PRIMARY_SCANNER", { method: "POST" })).status).toBe(403);
    expect((await apiRequest(env, "/api/tickets/1/cancel", "SECONDARY_SCANNER", { method: "POST" })).status).toBe(403);
    expect((await apiRequest(env, "/api/tickets/1/restore", "PRIMARY_SCANNER", { method: "POST" })).status).toBe(403);
  });

  it("lists, retrieves, and idempotently cancels a ticket", async () => {
    const env = testEnv();
    const createdResponse = await apiRequest(env, "/api/tickets", "ADMIN", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestName: "Maya Chen", ticketType: "General admission" }),
    });
    const created = await createdResponse.json() as { ticket: { id: number } };

    const listed = await apiRequest(env, "/api/tickets", "ADMIN");
    await expect(listed.json()).resolves.toMatchObject({ tickets: [{ id: created.ticket.id }] });

    const retrieved = await apiRequest(env, `/api/tickets/${created.ticket.id}`, "ADMIN");
    await expect(retrieved.json()).resolves.toMatchObject({ ticket: { guestName: "Maya Chen", voidedAt: null } });

    const firstCancel = await apiRequest(env, `/api/tickets/${created.ticket.id}/cancel`, "ADMIN", { method: "POST" });
    const firstBody = await firstCancel.json() as { ticket: { voidedAt: string } };
    expect(firstBody.ticket.voidedAt).toBeTruthy();
    const secondCancel = await apiRequest(env, `/api/tickets/${created.ticket.id}/cancel`, "ADMIN", { method: "POST" });
    await expect(secondCancel.json()).resolves.toMatchObject({ ticket: { voidedAt: firstBody.ticket.voidedAt } });
  });
});
