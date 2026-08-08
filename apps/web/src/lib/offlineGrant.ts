import {
  OFFLINE_GRANT_MAX_LIFETIME_SECONDS,
  OFFLINE_GRANT_PUBLIC_KEY_SPKI,
  OFFLINE_GRANT_SCOPE,
} from "../config/offlineGrant";
import { getStoredOfflineGrant } from "./offlineStore";

export type OfflineGrantPayload = {
  v: 1;
  type: "offline_scanner_grant";
  role: "PRIMARY_SCANNER";
  scope: typeof OFFLINE_GRANT_SCOPE;
  iat: number;
  exp: number;
  jti: string;
};

export type OfflineGrantFailure =
  | "MISSING"
  | "MALFORMED"
  | "PUBLIC_KEY_UNAVAILABLE"
  | "INVALID_SIGNATURE"
  | "EXPIRED"
  | "WRONG_ROLE"
  | "WRONG_SCOPE"
  | "INVALID_CLAIMS";

export type OfflineGrantStatus =
  | { valid: true; payload: OfflineGrantPayload; grant: string; remainingSeconds: number }
  | { valid: false; reason: OfflineGrantFailure; detail: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function failure(reason: OfflineGrantFailure, detail: string): OfflineGrantStatus {
  return { valid: false, reason, detail };
}

export async function verifyOfflineGrant(
  grant: string | null,
  now = Date.now(),
  publicKeySpki = OFFLINE_GRANT_PUBLIC_KEY_SPKI,
): Promise<OfflineGrantStatus> {
  if (!grant) return failure("MISSING", "No offline grant prepared");
  if (!publicKeySpki) return failure("PUBLIC_KEY_UNAVAILABLE", "Offline verification key is not configured in this build");
  try {
    if (grant.length > 4096) return failure("MALFORMED", "Offline grant is too large");
    const [encodedPayload, encodedSignature, extra] = grant.split(".");
    if (!encodedPayload || !encodedSignature || extra
      || !base64UrlPattern.test(encodedPayload) || !base64UrlPattern.test(encodedSignature)) {
      return failure("MALFORMED", "Offline grant format is invalid");
    }
    const publicKey = await crypto.subtle.importKey(
      "spki",
      decodeBase64(publicKeySpki.replace(/\s/g, "")),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signatureValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      decodeBase64(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!signatureValid) return failure("INVALID_SIGNATURE", "Offline grant signature is invalid");

    const parsed = JSON.parse(decoder.decode(decodeBase64(encodedPayload))) as Partial<OfflineGrantPayload>;
    if (parsed.role !== "PRIMARY_SCANNER") return failure("WRONG_ROLE", "Offline grant is not for the Primary Scanner role");
    if (parsed.scope !== OFFLINE_GRANT_SCOPE) return failure("WRONG_SCOPE", "Offline grant belongs to a different application scope");
    const currentTime = Math.floor(now / 1000);
    if (parsed.v !== 1 || parsed.type !== "offline_scanner_grant"
      || !Number.isInteger(parsed.iat) || !Number.isInteger(parsed.exp)
      || typeof parsed.jti !== "string" || parsed.jti.length < 16
      || Number(parsed.iat) > currentTime + 60
      || Number(parsed.exp) <= Number(parsed.iat)
      || Number(parsed.exp) - Number(parsed.iat) > OFFLINE_GRANT_MAX_LIFETIME_SECONDS) {
      return failure("INVALID_CLAIMS", "Offline grant claims are invalid");
    }
    if (Number(parsed.exp) <= currentTime) return failure("EXPIRED", "Offline grant expired");
    return {
      valid: true,
      payload: parsed as OfflineGrantPayload,
      grant,
      remainingSeconds: Number(parsed.exp) - currentTime,
    };
  } catch {
    return failure("MALFORMED", "Offline grant could not be decoded or verified");
  }
}

export async function inspectStoredOfflineGrant(now = Date.now()): Promise<OfflineGrantStatus> {
  return verifyOfflineGrant(await getStoredOfflineGrant(), now);
}
