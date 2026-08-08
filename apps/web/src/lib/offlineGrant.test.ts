import { beforeAll, describe, expect, it } from "vitest";
import { verifyOfflineGrant } from "./offlineGrant";

let privateKey: CryptoKey;
let publicKeySpki = "";
const now = Date.parse("2026-08-08T20:00:00.000Z");

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(claims: Record<string, unknown>, key = privateKey): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const issuedAt = Math.floor(now / 1000);
  return {
    v: 1, type: "offline_scanner_grant", role: "PRIMARY_SCANNER", scope: "party-check-in",
    iat: issuedAt, exp: issuedAt + 12 * 60 * 60, jti: "offline-grant-test-id-123", ...overrides,
  };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  privateKey = pair.privateKey;
  publicKeySpki = toBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)));
});

describe("offline grant verification", () => {
  it("accepts a valid Primary grant", async () => {
    await expect(verifyOfflineGrant(await sign(claims()), now, publicKeySpki)).resolves.toMatchObject({ valid: true });
  });

  it("rejects tampering and signatures from another key", async () => {
    const valid = await sign(claims());
    const [payload, signature] = valid.split(".");
    const changed = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;
    await expect(verifyOfflineGrant(changed, now, publicKeySpki)).resolves.toMatchObject({ valid: false, reason: "INVALID_SIGNATURE" });
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    await expect(verifyOfflineGrant(await sign(claims(), other.privateKey), now, publicKeySpki)).resolves.toMatchObject({ valid: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects expired, wrong-role, and wrong-scope signed grants", async () => {
    await expect(verifyOfflineGrant(await sign(claims({ iat: 1, exp: 2 })), now, publicKeySpki)).resolves.toMatchObject({ reason: "EXPIRED" });
    await expect(verifyOfflineGrant(await sign(claims({ role: "SECONDARY_SCANNER" })), now, publicKeySpki)).resolves.toMatchObject({ reason: "WRONG_ROLE" });
    await expect(verifyOfflineGrant(await sign(claims({ scope: "other-event" })), now, publicKeySpki)).resolves.toMatchObject({ reason: "WRONG_SCOPE" });
  });
});
