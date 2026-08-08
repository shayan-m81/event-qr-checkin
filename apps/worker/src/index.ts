import {
  createSessionToken,
  expiredSessionCookie,
  hasValidAuthConfiguration,
  isAuthResponse,
  requireRole,
  roleForAccessCode,
  sessionCookie,
  sessionFromRequest,
} from "./auth";
import { isSameOriginRequest, json, methodNotAllowed } from "./http";
import { handleCheckinRequest } from "./checkin";
import { handleGuestRequest } from "./guests";
import { handleOfflineRequest } from "./offline";
import { handleTicketRequest } from "./tickets";
import type { Env } from "./types";
import { errorType, logServerEvent } from "./logging";
import { ADMIN_ONLY, ONLINE_CHECKIN_ROLES } from "./permissions";
import { handleReadinessStatus } from "./readiness";
import { handleOfflineGrant } from "./offlineGrant";

async function login(request: Request, env: Env): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    logServerEvent("warn", "login_failed", { reason: "origin" });
    return json({ error: "forbidden" }, 403);
  }
  if (!hasValidAuthConfiguration(env)) {
    logServerEvent("error", "login_failed", { reason: "configuration" });
    return json({ error: "server_configuration_error" }, 500);
  }

  let accessCode: unknown;
  try {
    const body = await request.json() as { accessCode?: unknown };
    accessCode = body.accessCode;
  } catch {
    logServerEvent("warn", "login_failed", { reason: "malformed_request" });
    return json({ error: "invalid_request" }, 400);
  }
  if (typeof accessCode !== "string" || accessCode.length === 0 || accessCode.length > 256) {
    logServerEvent("warn", "login_failed", { reason: "invalid_request" });
    return json({ error: "invalid_request" }, 400);
  }

  const role = await roleForAccessCode(accessCode, env);
  if (!role) {
    logServerEvent("warn", "login_failed", { reason: "invalid_access_code" });
    return json({ error: "invalid_access_code" }, 401);
  }

  const token = await createSessionToken(role, env.SESSION_SECRET);
  return json(
    { authenticated: true, role },
    200,
    { "Set-Cookie": sessionCookie(token) },
  );
}

async function session(request: Request, env: Env): Promise<Response> {
  const currentSession = await sessionFromRequest(request, env);
  if (!currentSession) {
    return json(
      { authenticated: false },
      200,
      { "Set-Cookie": expiredSessionCookie() },
    );
  }
  return json({ authenticated: true, role: currentSession.role, expiresAt: currentSession.expiresAt });
}

async function adminStatus(request: Request, env: Env): Promise<Response> {
  const authorization = await requireRole(request, env, ADMIN_ONLY);
  if (isAuthResponse(authorization)) return authorization;
  return json({ available: true, role: authorization.role });
}

async function scannerStatus(request: Request, env: Env): Promise<Response> {
  const authorization = await requireRole(request, env, ONLINE_CHECKIN_ROLES);
  if (isAuthResponse(authorization)) return authorization;
  return json({ available: true, role: authorization.role });
}

async function api(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/auth/login") {
    return request.method === "POST" ? login(request, env) : methodNotAllowed(["POST"]);
  }
  if (pathname === "/api/auth/logout") {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() },
    });
  }
  if (pathname === "/api/auth/session") {
    return request.method === "GET" ? session(request, env) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/admin/status") {
    return request.method === "GET" ? adminStatus(request, env) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/scanner/status") {
    return request.method === "GET" ? scannerStatus(request, env) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/readiness/status") {
    return request.method === "GET" ? handleReadinessStatus(request, env) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/offline/grant") {
    return request.method === "POST" ? handleOfflineGrant(request, env) : methodNotAllowed(["POST"]);
  }
  if (pathname === "/api/checkin") {
    return request.method === "POST" ? handleCheckinRequest(request, env) : methodNotAllowed(["POST"]);
  }
  if (pathname === "/api/offline" || pathname.startsWith("/api/offline/")) {
    return await handleOfflineRequest(request, env) ?? json({ error: "not_found" }, 404);
  }
  if (pathname === "/api/guests" || pathname.startsWith("/api/guests/")) {
    return await handleGuestRequest(request, env) ?? json({ error: "not_found" }, 404);
  }
  if (pathname === "/api/tickets" || pathname.startsWith("/api/tickets/")) {
    return await handleTicketRequest(request, env) ?? json({ error: "not_found" }, 404);
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      try {
        return await api(request, env);
      } catch (error) {
        logServerEvent("error", "unexpected_server_error", {
          path: pathname,
          method: request.method,
          errorType: errorType(error),
        });
        return json({ error: "internal_server_error" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
