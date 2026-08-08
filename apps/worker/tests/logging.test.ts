import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import type { Env } from "../src/types";

const accessCode = "do-not-log-this-access-code";
const env = {
  ADMIN_ACCESS_CODE: "admin-test-access-code",
  PRIMARY_SCANNER_ACCESS_CODE: "primary-test-access-code",
  SECONDARY_SCANNER_ACCESS_CODE: "secondary-test-access-code",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
  DB: {},
} as unknown as Env;

afterEach(() => vi.restoreAllMocks());

describe("minimal structured server logging", () => {
  it("logs a login failure reason without the supplied access code", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await worker.fetch(new Request("https://party.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://party.test" },
      body: JSON.stringify({ accessCode }),
    }), env);
    expect(response.status).toBe(401);
    const output = warning.mock.calls.flat().join(" ");
    expect(output).toContain('"event":"login_failed"');
    expect(output).toContain('"reason":"invalid_access_code"');
    expect(output).not.toContain(accessCode);
  });

  it("returns a safe 500 and logs check-in failures without the ticket token", async () => {
    const ticketToken = "pt_secret12345678901234567890123456";
    const database = {
      prepare() {
        const statement = {
          bind() { return statement; },
          first() { throw new Error("database unavailable"); },
        };
        return statement;
      },
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const session = await createSessionToken("PRIMARY_SCANNER", env.SESSION_SECRET);
    const response = await worker.fetch(new Request("https://party.test/api/checkin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://party.test",
        Cookie: `${SESSION_COOKIE_NAME}=${session}`,
      },
      body: JSON.stringify({ token: ticketToken }),
    }), { ...env, DB: database as unknown as D1Database });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal_server_error" });
    const output = errorLog.mock.calls.flat().join(" ");
    expect(output).toContain('"event":"checkin_error"');
    expect(output).toContain('"event":"unexpected_server_error"');
    expect(output).not.toContain(ticketToken);
    expect(output).not.toContain("database unavailable");
  });
});
