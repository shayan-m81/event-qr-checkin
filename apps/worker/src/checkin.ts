import { isAuthResponse, requireRole } from "./auth";
import { performCheckin } from "./checkinService";
import { isSameOriginRequest, json } from "./http";
import { errorType, logServerEvent } from "./logging";
import { isTicketToken } from "./ticketToken";
import type { Env } from "./types";
import { ONLINE_CHECKIN_ROLES } from "./permissions";

export async function handleCheckinRequest(request: Request, env: Env): Promise<Response> {
  const authorization = await requireRole(request, env, ONLINE_CHECKIN_ROLES);
  if (isAuthResponse(authorization)) return authorization;
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);

  let body: { token?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (typeof body.token !== "string" || body.token !== body.token.trim() || !isTicketToken(body.token)) {
    return json({ error: "invalid_request" }, 400);
  }

  try {
    return json(await performCheckin({
      env,
      token: body.token,
      actorRole: authorization.role,
      source: "QR",
    }));
  } catch (error) {
    logServerEvent("error", "checkin_error", { role: authorization.role, errorType: errorType(error) });
    throw error;
  }
}
