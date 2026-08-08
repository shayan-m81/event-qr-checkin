import { isAuthResponse, requireRole } from "./auth";
import { performCheckin } from "./checkinService";
import { isSameOriginRequest, json, methodNotAllowed } from "./http";
import type { Env, Session } from "./types";
import { AUTHENTICATED_STAFF } from "./permissions";

const GUEST_RESULT_LIMIT = 200;
const MAX_SEARCH_LENGTH = 120;

type GuestRow = {
  ticket_id: number;
  guest_name: string;
  ticket_type: string;
  voided_at: string | null;
  checked_in_at: string | null;
  checkin_source: string | null;
};

type TotalsRow = {
  total_tickets: number;
  checked_in_count: number;
  remaining_count: number;
};

function guestFromRow(row: GuestRow) {
  return {
    ticketId: row.ticket_id,
    guestName: row.guest_name,
    ticketType: row.ticket_type,
    status: row.voided_at ? "CANCELLED" : row.checked_in_at ? "CHECKED_IN" : "NOT_ARRIVED",
    checkedInAt: row.checked_in_at,
    checkinSource: row.checkin_source,
  };
}

function prefixUpperBound(query: string): string {
  return `${query}\u{10ffff}`;
}

async function listGuests(request: Request, env: Env, session: Session): Promise<Response> {
  const query = (new URL(request.url).searchParams.get("query") ?? "").trim().replace(/\s+/g, " ");
  if (query.length > MAX_SEARCH_LENGTH) return json({ error: "invalid_search" }, 400);

  const statement = query
    ? env.DB.prepare(`
        SELECT
          tickets.id AS ticket_id,
          tickets.guest_name,
          tickets.ticket_type,
          tickets.voided_at,
          checkins.checked_in_at,
          checkins.source AS checkin_source
        FROM tickets
        LEFT JOIN checkins ON checkins.ticket_id = tickets.id
        WHERE tickets.guest_name >= ? COLLATE NOCASE
          AND tickets.guest_name < ? COLLATE NOCASE
        ORDER BY tickets.guest_name COLLATE NOCASE, tickets.id
        LIMIT ?
      `).bind(query, prefixUpperBound(query), GUEST_RESULT_LIMIT)
    : env.DB.prepare(`
        SELECT
          tickets.id AS ticket_id,
          tickets.guest_name,
          tickets.ticket_type,
          tickets.voided_at,
          checkins.checked_in_at,
          checkins.source AS checkin_source
        FROM tickets
        LEFT JOIN checkins ON checkins.ticket_id = tickets.id
        ORDER BY tickets.guest_name COLLATE NOCASE, tickets.id
        LIMIT ?
      `).bind(GUEST_RESULT_LIMIT);
  const result = await statement.all<GuestRow>();
  return json({
    guests: result.results.map(guestFromRow),
    query,
    canManualCheckIn: session.role === "ADMIN",
    canManageTickets: session.role === "ADMIN",
  });
}

async function totals(env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(tickets.id) AS total_tickets,
      SUM(CASE WHEN checkins.id IS NOT NULL THEN 1 ELSE 0 END) AS checked_in_count,
      SUM(CASE WHEN checkins.id IS NULL THEN 1 ELSE 0 END) AS remaining_count
    FROM tickets
    LEFT JOIN checkins ON checkins.ticket_id = tickets.id
    WHERE tickets.voided_at IS NULL
  `).first<TotalsRow>();
  return json({
    totalTickets: row?.total_tickets ?? 0,
    checkedInCount: row?.checked_in_count ?? 0,
    remainingCount: row?.remaining_count ?? 0,
  });
}

async function manualCheckin(ticketId: number, request: Request, env: Env, session: Session): Promise<Response> {
  if (session.role !== "ADMIN") return json({ error: "forbidden" }, 403);
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  return json(await performCheckin({
    env,
    ticketId,
    actorRole: session.role,
    source: "MANUAL",
  }));
}

export async function handleGuestRequest(request: Request, env: Env): Promise<Response | null> {
  const authorization = await requireRole(request, env, AUTHENTICATED_STAFF);
  if (isAuthResponse(authorization)) return authorization;
  const { pathname } = new URL(request.url);

  if (pathname === "/api/guests") {
    return request.method === "GET" ? listGuests(request, env, authorization) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/guests/totals") {
    return request.method === "GET" ? totals(env) : methodNotAllowed(["GET"]);
  }
  const manualMatch = pathname.match(/^\/api\/guests\/(\d+)\/checkin$/);
  if (manualMatch) {
    return request.method === "POST"
      ? manualCheckin(Number(manualMatch[1]), request, env, authorization)
      : methodNotAllowed(["POST"]);
  }
  return null;
}
