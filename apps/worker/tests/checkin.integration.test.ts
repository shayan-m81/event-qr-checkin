import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

const integrationEnv = env as unknown as Env;
const validToken = "pt_12345678901234567890123456789012";
const voidedToken = "pt_abcdefghijklmnopqrstuvwxyz123456";

async function cookie(role: Role): Promise<string> {
  const token = await createSessionToken(role, integrationEnv.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function checkin(token: unknown, role: Role | null = "PRIMARY_SCANNER"): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json", Origin: "https://party.test" });
  if (role) headers.set("Cookie", await cookie(role));
  return worker.fetch(new Request("https://party.test/api/checkin", {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  }), integrationEnv);
}

async function seedTicket(token: string, voided = false): Promise<void> {
  await integrationEnv.DB.prepare(`
    INSERT INTO tickets (token, guest_name, ticket_type, voided_at)
    VALUES (?, 'Maya Chen', 'VIP', ?)
  `).bind(token, voided ? "2026-08-08T00:00:00.000Z" : null).run();
}

beforeEach(async () => {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare("DELETE FROM checkins"),
    integrationEnv.DB.prepare("DELETE FROM tickets"),
  ]);
});

describe("POST /api/checkin with real D1 constraints", () => {
  it("accepts a valid first check-in", async () => {
    await seedTicket(validToken);
    const response = await checkin(validToken);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      state: "VALID",
      guestName: "Maya Chen",
      ticketType: "VIP",
      checkedInCount: 1,
    });
  });

  it("returns the authoritative original check-in for a second scan", async () => {
    await seedTicket(validToken);
    const first = await checkin(validToken);
    const firstBody = await first.json() as { checkedInAt: string };
    const second = await checkin(validToken, "SECONDARY_SCANNER");
    await expect(second.json()).resolves.toMatchObject({
      state: "ALREADY_USED",
      guestName: "Maya Chen",
      checkedInAt: firstBody.checkedInAt,
      checkedInCount: 1,
    });
  });

  it("allows exactly one winner from two nearly simultaneous phones", async () => {
    await seedTicket(validToken);
    const [primary, secondary] = await Promise.all([
      checkin(validToken, "PRIMARY_SCANNER"),
      checkin(validToken, "SECONDARY_SCANNER"),
    ]);
    const states = await Promise.all([primary.json(), secondary.json()]) as Array<{ state: string }>;
    expect(states.map(({ state }) => state).sort()).toEqual(["ALREADY_USED", "VALID"]);
    const row = await integrationEnv.DB.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT ticket_id) AS distinct_tickets
      FROM checkins
    `).first<{ count: number; distinct_tickets: number }>();
    expect(row).toEqual(expect.objectContaining({ count: 1, distinct_tickets: 1 }));
  });

  it("returns INVALID for an unknown token", async () => {
    await expect((await checkin("pt_unknown-ticket-token")).json())
      .resolves.toMatchObject({ state: "INVALID", checkedInCount: 0 });
  });

  it("returns VOIDED without creating a check-in", async () => {
    await seedTicket(voidedToken, true);
    await expect((await checkin(voidedToken)).json())
      .resolves.toMatchObject({ state: "VOIDED", guestName: "Maya Chen", checkedInCount: 0 });
    const row = await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM checkins")
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("allows every online scanner role, including ADMIN, and rejects anonymous requests", async () => {
    await seedTicket(validToken);
    expect((await checkin(validToken, null)).status).toBe(401);
    const admin = await checkin(validToken, "ADMIN");
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({ state: "VALID", guestName: "Maya Chen" });
  });

  it.each([null, "", "   ", "https://example.com/ticket", `pt_${"x".repeat(129)}`, 42, { token: validToken }])("rejects malformed token input", async (token) => {
    const response = await checkin(token);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
  });
});
