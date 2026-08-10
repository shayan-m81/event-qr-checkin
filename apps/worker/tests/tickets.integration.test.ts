import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env } from "../src/types";

const integrationEnv = env as unknown as Env;

async function adminCookie(): Promise<string> {
  const token = await createSessionToken("ADMIN", integrationEnv.SESSION_SECRET);
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", await adminCookie());
  if (init.method === "POST") headers.set("Origin", "https://party.test");
  return worker.fetch(new Request(`https://party.test${path}`, { ...init, headers }), integrationEnv);
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
