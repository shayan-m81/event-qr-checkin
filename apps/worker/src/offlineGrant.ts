import { isAuthResponse, requireRole } from "./auth";
import { isSameOriginRequest, json } from "./http";
import { logServerEvent } from "./logging";
import { PRIMARY_OFFLINE_ONLY } from "./permissions";
import type { Env } from "./types";

export const OFFLINE_GRANT_DURATION_SECONDS = 12 * 60 * 60;
export const OFFLINE_GRANT_SCOPE = "party-check-in";

export type OfflineGrantPayload = {
  v: 1;
  type: "offline_scanner_grant";
  role: "PRIMARY_SCANNER";
  scope: typeof OFFLINE_GRANT_SCOPE;
  iat: number;
  exp: number;
  jti: string;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function pemToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!base64) throw new Error("Offline grant private key is missing");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function createOfflineGrant(
  privateKeyPem: string,
  now = Date.now(),
): Promise<{ grant: string; payload: OfflineGrantPayload }> {
  const issuedAt = Math.floor(now / 1000);
  const payload: OfflineGrantPayload = {
    v: 1,
    type: "offline_scanner_grant",
    role: "PRIMARY_SCANNER",
    scope: OFFLINE_GRANT_SCOPE,
    iat: issuedAt,
    exp: issuedAt + OFFLINE_GRANT_DURATION_SECONDS,
    jti: crypto.randomUUID(),
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(encodedPayload),
  );
  return { grant: `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`, payload };
}

export async function handleOfflineGrant(request: Request, env: Env): Promise<Response> {
  const authorization = await requireRole(request, env, PRIMARY_OFFLINE_ONLY);
  if (isAuthResponse(authorization)) return authorization;
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  try {
    const { grant, payload } = await createOfflineGrant(env.OFFLINE_GRANT_PRIVATE_KEY);
    return json({ grant, expiresAt: payload.exp, role: payload.role });
  } catch (error) {
    logServerEvent("error", "offline_grant_error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return json({ error: "offline_grant_configuration_error" }, 500);
  }
}
