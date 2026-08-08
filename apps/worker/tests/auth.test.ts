import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import type { Env, Role } from "../src/types";

const env = {
  ADMIN_ACCESS_CODE: "admin-test-access-code",
  PRIMARY_SCANNER_ACCESS_CODE: "primary-test-access-code",
  SECONDARY_SCANNER_ACCESS_CODE: "secondary-test-access-code",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
  DB: {},
} as unknown as Env;

async function request(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://party.test${path}`, init), env);
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("Set-Cookie");
  if (!setCookie) throw new Error("Expected session cookie");
  return setCookie.split(";", 1)[0];
}

async function login(accessCode: string): Promise<Response> {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://party.test" },
    body: JSON.stringify({ accessCode }),
  });
}

describe("authentication API", () => {
  const cases: Array<[Role, string]> = [
    ["ADMIN", env.ADMIN_ACCESS_CODE],
    ["PRIMARY_SCANNER", env.PRIMARY_SCANNER_ACCESS_CODE],
    ["SECONDARY_SCANNER", env.SECONDARY_SCANNER_ACCESS_CODE],
  ];

  it.each(cases)("logs in the %s role", async (expectedRole, accessCode) => {
    const response = await login(accessCode);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ authenticated: true, role: expectedRole });
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toMatch(/Max-Age=\d+/);
  });

  it("rejects an invalid access code without issuing a cookie", async () => {
    const response = await login("wrong-code");
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "invalid_access_code" });
  });

  it("fails safely when access-code secrets are duplicated", async () => {
    const invalidEnv = { ...env, ADMIN_ACCESS_CODE: env.PRIMARY_SCANNER_ACCESS_CODE };
    const response = await worker.fetch(new Request("https://party.test/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: invalidEnv.ADMIN_ACCESS_CODE }),
    }), invalidEnv);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "server_configuration_error" });
  });

  it("rejects unauthenticated access to a protected API", async () => {
    const response = await request("/api/admin/status");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("enforces role-specific API access", async () => {
    const scannerCookie = cookieFrom(await login(env.PRIMARY_SCANNER_ACCESS_CODE));
    const forbidden = await request("/api/admin/status", { headers: { Cookie: scannerCookie } });
    expect(forbidden.status).toBe(403);

    const allowed = await request("/api/scanner/status", { headers: { Cookie: scannerCookie } });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ role: "PRIMARY_SCANNER" });

    const adminCookie = cookieFrom(await login(env.ADMIN_ACCESS_CODE));
    const adminScanner = await request("/api/scanner/status", { headers: { Cookie: adminCookie } });
    expect(adminScanner.status).toBe(200);
    await expect(adminScanner.json()).resolves.toMatchObject({ role: "ADMIN" });
  });

  it.each(cases)("returns a valid %s session only from its signed cookie", async (expectedRole, accessCode) => {
    const validCookie = cookieFrom(await login(accessCode));
    const valid = await request("/api/auth/session", { headers: { Cookie: validCookie } });
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({ authenticated: true, role: expectedRole });
  });

  it("returns unauthenticated for missing, invalid, and expired cookies", async () => {
    await expect((await request("/api/auth/session")).json()).resolves.toEqual({ authenticated: false });

    const invalid = await request("/api/auth/session", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=not-a-valid-session` },
    });
    await expect(invalid.json()).resolves.toEqual({ authenticated: false });

    const expiredToken = await createSessionToken("ADMIN", env.SESSION_SECRET, Date.now() - 13 * 60 * 60 * 1000);
    const expired = await request("/api/auth/session", {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${expiredToken}` },
    });
    await expect(expired.json()).resolves.toEqual({ authenticated: false });
  });

  it.each(cases)("logs out %s with cookie-compatible invalidation", async (_role, accessCode) => {
    const activeCookie = cookieFrom(await login(accessCode));
    expect((await request("/api/auth/session", { headers: { Cookie: activeCookie } })).status).toBe(200);
    const response = await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: activeCookie, Origin: "https://party.test" },
    });
    expect(response.status).toBe(204);
    const cleared = response.headers.get("Set-Cookie") ?? "";
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("SameSite=Strict");
    expect(cleared).toContain("Max-Age=0");
  });

  it("uses no-store on every authentication response", async () => {
    const loginResponse = await login(env.ADMIN_ACCESS_CODE);
    const cookie = cookieFrom(loginResponse);
    const sessionResponse = await request("/api/auth/session", { headers: { Cookie: cookie } });
    const logoutResponse = await request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://party.test" },
    });
    expect(loginResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(sessionResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(logoutResponse.headers.get("Cache-Control")).toBe("no-store");
  });
});
