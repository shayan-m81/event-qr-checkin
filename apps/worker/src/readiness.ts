import { isAuthResponse, requireRole } from "./auth";
import { json } from "./http";
import { READINESS_ROLES } from "./permissions";
import type { Env } from "./types";

export async function handleReadinessStatus(request: Request, env: Env): Promise<Response> {
  const authorization = await requireRole(request, env, READINESS_ROLES);
  if (isAuthResponse(authorization)) return authorization;
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM tickets").first<{ count: number }>();
  return json({ ticketCount: row?.count ?? 0, checkedAt: new Date().toISOString() });
}
