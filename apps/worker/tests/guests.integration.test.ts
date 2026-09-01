import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

const integrationEnv = env as unknown as Env;
const tokens = {
  maya: "pt_maya1234567890123456789012345678",
  noah: "pt_noah1234567890123456789012345678",
  voided: "pt_void1234567890123456789012345678",
};

async function cookie(role: Role): Promise<string> {
  const token = await createSessionToken(role, integrationEnv.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function api(path: string, role: Role | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (role) headers.set("Cookie", await cookie(role));
  if (init.method === "POST") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), integrationEnv);
}

async function seedGuests(): Promise<void> {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare(`
      INSERT INTO tickets (token, guest_name, referee_name, ticket_type)
      VALUES (?, 'Maya Chen', 'Sam Rivera', 'VIP')
    `).bind(tokens.maya),
    integrationEnv.DB.prepare(`
      INSERT INTO tickets (token, guest_name, referee_name, ticket_type)
      VALUES (?, 'Noah Williams', 'Alex Morgan', 'General admission')
    `).bind(tokens.noah),
    integrationEnv.DB.prepare(`
      INSERT INTO tickets (token, guest_name, referee_name, ticket_type, voided_at)
      VALUES (?, 'Vera Void', 'Sam Rivera', 'VIP', '2026-08-08T00:00:00.000Z')
    `).bind(tokens.voided),
  ]);
}

async function ticketId(token: string): Promise<number> {
  const row = await integrationEnv.DB.prepare("SELECT id FROM tickets WHERE token = ?")
    .bind(token).first<{ id: number }>();
  if (!row) throw new Error("Missing seeded ticket");
  return row.id;
}

beforeEach(async () => {
  await integrationEnv.DB.batch([
    integrationEnv.DB.prepare("DELETE FROM checkins"),
    integrationEnv.DB.prepare("DELETE FROM tickets"),
  ]);
});

describe("guest list APIs", () => {
  it.each<Role>(["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"])(
    "allows %s to search authoritative guest status",
    async (role) => {
      await seedGuests();
      const mayaId = await ticketId(tokens.maya);
      await integrationEnv.DB.prepare(`
        INSERT INTO checkins (ticket_id, scanner_role, source)
        VALUES (?, 'PRIMARY_SCANNER', 'QR')
      `).bind(mayaId).run();

      const response = await api("/api/guests?query=May", role);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        guests: Array<Record<string, unknown>>;
        canManualCheckIn: boolean;
        canManageTickets: boolean;
      };
      expect(body.guests).toHaveLength(1);
      expect(body.guests[0]).toMatchObject({
        ticketId: mayaId,
        guestName: "Maya Chen",
        refereeName: "Sam Rivera",
        createdAt: expect.any(String),
        status: "CHECKED_IN",
        checkinSource: "QR",
      });
      expect(body.guests[0]).not.toHaveProperty("token");
      expect(body.canManualCheckIn).toBe(role === "ADMIN");
      expect(body.canManageTickets).toBe(role === "ADMIN");
    },
  );

  it("filters guests by referee prefix and ticket type", async () => {
    await seedGuests();
    const vipBySam = await api("/api/guests?referee=Sam&ticketType=VIP", "PRIMARY_SCANNER");
    const body = await vipBySam.json() as { guests: Array<{ guestName: string; refereeName: string; ticketType: string }> };
    expect(body.guests).toEqual([
      expect.objectContaining({ guestName: "Vera Void", refereeName: "Sam Rivera", ticketType: "VIP" }),
      expect.objectContaining({ guestName: "Maya Chen", refereeName: "Sam Rivera", ticketType: "VIP" }),
    ]);

    const general = await api("/api/guests?ticketType=General%20admission", "SECONDARY_SCANNER");
    await expect(general.json()).resolves.toMatchObject({
      guests: [{ guestName: "Noah Williams", refereeName: "Alex Morgan" }],
    });
  });

  it("lists newest guests first, in plain and filtered views", async () => {
    await seedGuests();
    const all = await api("/api/guests", "PRIMARY_SCANNER");
    const allBody = await all.json() as { guests: Array<{ guestName: string }> };
    expect(allBody.guests.map((guest) => guest.guestName)).toEqual([
      "Vera Void",
      "Noah Williams",
      "Maya Chen",
    ]);

    const bySam = await api("/api/guests?referee=Sam", "PRIMARY_SCANNER");
    const samBody = await bySam.json() as { guests: Array<{ guestName: string }> };
    expect(samBody.guests.map((guest) => guest.guestName)).toEqual(["Vera Void", "Maya Chen"]);
  });

  it("filters guests by authoritative check-in status", async () => {
    await seedGuests();
    const mayaId = await ticketId(tokens.maya);
    await integrationEnv.DB.prepare(`
      INSERT INTO checkins (ticket_id, scanner_role, source)
      VALUES (?, 'PRIMARY_SCANNER', 'QR')
    `).bind(mayaId).run();

    await expect((await api("/api/guests?status=CHECKED_IN", "ADMIN")).json()).resolves.toMatchObject({
      guests: [{ guestName: "Maya Chen", status: "CHECKED_IN" }],
    });
    await expect((await api("/api/guests?status=NOT_ARRIVED", "PRIMARY_SCANNER")).json()).resolves.toMatchObject({
      guests: [{ guestName: "Noah Williams", status: "NOT_ARRIVED" }],
    });
    await expect((await api("/api/guests?status=CANCELLED", "SECONDARY_SCANNER")).json()).resolves.toMatchObject({
      guests: [{ guestName: "Vera Void", status: "CANCELLED" }],
    });
  });

  it("rejects malformed guest ticket-type filters", async () => {
    expect((await api("/api/guests?ticketType=Backstage", "ADMIN")).status).toBe(400);
    expect((await api("/api/guests?status=UNKNOWN", "ADMIN")).status).toBe(400);
  });

  it("returns active-ticket totals from D1", async () => {
    await seedGuests();
    const mayaId = await ticketId(tokens.maya);
    await integrationEnv.DB.prepare(`
      INSERT INTO checkins (ticket_id, scanner_role, source)
      VALUES (?, 'PRIMARY_SCANNER', 'QR')
    `).bind(mayaId).run();

    const response = await api("/api/guests/totals", "SECONDARY_SCANNER");
    await expect(response.json()).resolves.toEqual({
      totalTickets: 2,
      checkedInCount: 1,
      remainingCount: 1,
    });
  });

  it("manually checks in through the shared service and records ADMIN/MANUAL", async () => {
    await seedGuests();
    const noahId = await ticketId(tokens.noah);
    const response = await api(`/api/guests/${noahId}/checkin`, "ADMIN", { method: "POST" });
    await expect(response.json()).resolves.toMatchObject({
      state: "VALID",
      guestName: "Noah Williams",
      checkedInCount: 1,
    });
    const row = await integrationEnv.DB.prepare(`
      SELECT scanner_role, source FROM checkins WHERE ticket_id = ?
    `).bind(noahId).first<{ scanner_role: string; source: string }>();
    expect(row).toEqual(expect.objectContaining({ scanner_role: "ADMIN", source: "MANUAL" }));
  });

  it("returns ALREADY_USED and VOIDED clearly for manual fallback", async () => {
    await seedGuests();
    const mayaId = await ticketId(tokens.maya);
    const voidedId = await ticketId(tokens.voided);
    await api(`/api/guests/${mayaId}/checkin`, "ADMIN", { method: "POST" });

    await expect((await api(`/api/guests/${mayaId}/checkin`, "ADMIN", { method: "POST" })).json())
      .resolves.toMatchObject({ state: "ALREADY_USED", guestName: "Maya Chen" });
    await expect((await api(`/api/guests/${voidedId}/checkin`, "ADMIN", { method: "POST" })).json())
      .resolves.toMatchObject({ state: "VOIDED", guestName: "Vera Void" });
  });

  it("keeps a cancelled ticket visible with CANCELLED status", async () => {
    await seedGuests();
    const response = await api("/api/guests?query=Vera", "PRIMARY_SCANNER");
    await expect(response.json()).resolves.toMatchObject({
      guests: [{ guestName: "Vera Void", status: "CANCELLED" }],
    });
  });

  it("allows only ADMIN to perform manual check-in", async () => {
    await seedGuests();
    const mayaId = await ticketId(tokens.maya);
    expect((await api(`/api/guests/${mayaId}/checkin`, null, { method: "POST" })).status).toBe(401);
    expect((await api(`/api/guests/${mayaId}/checkin`, "PRIMARY_SCANNER", { method: "POST" })).status).toBe(403);
    expect((await api(`/api/guests/${mayaId}/checkin`, "SECONDARY_SCANNER", { method: "POST" })).status).toBe(403);
  });

  it("allows only one winner when QR and manual fallback race", async () => {
    await seedGuests();
    const mayaId = await ticketId(tokens.maya);
    const [manual, qr] = await Promise.all([
      api(`/api/guests/${mayaId}/checkin`, "ADMIN", { method: "POST" }),
      api("/api/checkin", "PRIMARY_SCANNER", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokens.maya }),
      }),
    ]);
    const outcomes = await Promise.all([manual.json(), qr.json()]) as Array<{ state: string }>;
    expect(outcomes.map(({ state }) => state).sort()).toEqual(["ALREADY_USED", "VALID"]);
    const row = await integrationEnv.DB.prepare("SELECT COUNT(*) AS count FROM checkins WHERE ticket_id = ?")
      .bind(mayaId).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });
});
