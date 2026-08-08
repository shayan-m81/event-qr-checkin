import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/auth";
import worker from "../src/index";
import type { Env, Role } from "../src/types";

let privateKeyPem = "";
let publicKey: CryptoKey;

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicKey = pair.publicKey;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${base64(pkcs8)}\n-----END PRIVATE KEY-----`;
});

const baseEnv = {
  ADMIN_ACCESS_CODE: "admin-test-access-code",
  PRIMARY_SCANNER_ACCESS_CODE: "primary-test-access-code",
  SECONDARY_SCANNER_ACCESS_CODE: "secondary-test-access-code",
  SESSION_SECRET: "test-session-secret-with-more-than-32-characters",
  ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
  DB: {},
} as unknown as Env;

async function requestGrant(role: Role | null): Promise<Response> {
  const headers = new Headers({ Origin: "https://party.test" });
  if (role) {
    const session = await createSessionToken(role, baseEnv.SESSION_SECRET);
    headers.set("Cookie", `${SESSION_COOKIE_NAME}=${session}`);
  }
  return worker.fetch(new Request("https://party.test/api/offline/grant", { method: "POST", headers }), {
    ...baseEnv,
    OFFLINE_GRANT_PRIVATE_KEY: privateKeyPem,
  });
}

describe("Primary offline grant issuance", () => {
  it("issues a signed, scoped, short-lived capability only to Primary", async () => {
    const response = await requestGrant("PRIMARY_SCANNER");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { grant: string };
    const [payload, signature] = body.grant.split(".");
    await expect(crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, publicKey, fromBase64Url(signature), new TextEncoder().encode(payload),
    )).resolves.toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    expect(claims).toMatchObject({ v: 1, type: "offline_scanner_grant", role: "PRIMARY_SCANNER", scope: "party-check-in" });
    expect(claims.exp - claims.iat).toBe(12 * 60 * 60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([null, "ADMIN", "SECONDARY_SCANNER"] as const)("rejects grant issuance for %s", async (role) => {
    const response = await requestGrant(role);
    expect(response.status).toBe(role === null ? 401 : 403);
  });

  it("does not accept an offline grant as online API authentication", async () => {
    const issued = await requestGrant("PRIMARY_SCANNER");
    const { grant } = await issued.json() as { grant: string };
    const response = await worker.fetch(new Request("https://party.test/api/admin/status", {
      headers: { "X-Offline-Grant": grant },
    }), { ...baseEnv, OFFLINE_GRANT_PRIVATE_KEY: privateKeyPem });
    expect(response.status).toBe(401);
  });
});
