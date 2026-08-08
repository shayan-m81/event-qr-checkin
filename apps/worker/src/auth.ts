import { json } from "./http";
import { roles, type Env, type Role, type Session } from "./types";

export const SESSION_COOKIE_NAME = "__Host-party_session";
export const SESSION_DURATION_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function signature(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function configuredAccessCodes(env: Env): Array<[Role, string]> {
  return [
    ["ADMIN", env.ADMIN_ACCESS_CODE],
    ["PRIMARY_SCANNER", env.PRIMARY_SCANNER_ACCESS_CODE],
    ["SECONDARY_SCANNER", env.SECONDARY_SCANNER_ACCESS_CODE],
  ];
}

export function hasValidAuthConfiguration(env: Env): boolean {
  const codes = configuredAccessCodes(env).map(([, code]) => code);
  return (
    typeof env.SESSION_SECRET === "string" &&
    encoder.encode(env.SESSION_SECRET).length >= 32 &&
    codes.every((code) => typeof code === "string" && code.length > 0) &&
    new Set(codes).size === codes.length
  );
}

export async function roleForAccessCode(accessCode: string, env: Env): Promise<Role | null> {
  const suppliedDigest = await digest(accessCode);
  const comparisons = await Promise.all(
    configuredAccessCodes(env).map(async ([role, configuredCode]) => ({
      role,
      matches: configuredCode.length > 0 && safeEqual(suppliedDigest, await digest(configuredCode)),
    })),
  );
  const matches = comparisons.filter((comparison) => comparison.matches);
  return matches.length === 1 ? matches[0].role : null;
}

export async function createSessionToken(
  role: Role,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const session: Session = {
    version: 1,
    role,
    issuedAt,
    expiresAt: issuedAt + SESSION_DURATION_SECONDS,
    sessionId: crypto.randomUUID(),
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const signed = await signature(payload, secret);
  return `${payload}.${toBase64Url(signed)}`;
}

export async function validateSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<Session | null> {
  try {
    const [payload, encodedSignature, extra] = token.split(".");
    if (!payload || !encodedSignature || extra) return null;
    const expected = await signature(payload, secret);
    if (!safeEqual(expected, fromBase64Url(encodedSignature))) return null;

    const session = JSON.parse(decoder.decode(fromBase64Url(payload))) as Partial<Session>;
    const currentTime = Math.floor(now / 1000);
    if (
      session.version !== 1 ||
      !roles.includes(session.role as Role) ||
      typeof session.issuedAt !== "number" ||
      typeof session.expiresAt !== "number" ||
      !Number.isInteger(session.issuedAt) ||
      !Number.isInteger(session.expiresAt) ||
      typeof session.sessionId !== "string" ||
      session.sessionId.length < 16 ||
      session.issuedAt > currentTime + 60 ||
      session.expiresAt <= session.issuedAt ||
      session.expiresAt - session.issuedAt > SESSION_DURATION_SECONDS ||
      session.expiresAt <= currentTime
    ) return null;
    return session as Session;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string, now = Date.now()): string {
  const expires = new Date(now + SESSION_DURATION_SECONDS * 1000).toUTCString();
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}; Expires=${expires}`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export async function sessionFromRequest(request: Request, env: Env): Promise<Session | null> {
  const token = cookieValue(request, SESSION_COOKIE_NAME);
  if (!token || typeof env.SESSION_SECRET !== "string" || encoder.encode(env.SESSION_SECRET).length < 32) return null;
  return validateSessionToken(token, env.SESSION_SECRET);
}

export async function requireRole(
  request: Request,
  env: Env,
  allowedRoles: readonly Role[],
): Promise<Session | Response> {
  const session = await sessionFromRequest(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!allowedRoles.includes(session.role)) return json({ error: "forbidden" }, 403);
  return session;
}

export function isAuthResponse(value: Session | Response): value is Response {
  return value instanceof Response;
}
