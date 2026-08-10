import { isAuthResponse, requireRole } from "./auth";
import { isSameOriginRequest, json, methodNotAllowed } from "./http";
import type { Env } from "./types";
import { ADMIN_ONLY } from "./permissions";
import { isTicketToken } from "./ticketToken";

const TOKEN_RANDOM_BYTES = 24;
const TOKEN_INSERT_ATTEMPTS = 3;
const MAX_GUEST_NAME_LENGTH = 120;
const MAX_REFEREE_NAME_LENGTH = 120;
const ticketTypes = ["General admission", "VIP"] as const;

type TicketInput = {
  guestName: string;
  refereeName: string;
  ticketType: (typeof ticketTypes)[number];
};

type TicketInputResult =
  | { valid: true; value: TicketInput }
  | { valid: false; error: "invalid_guest_name" | "invalid_referee_name" | "invalid_ticket_type" };

type TicketRow = {
  id: number;
  token: string;
  guest_name: string;
  referee_name: string;
  ticket_type: string;
  created_at: string;
  voided_at: string | null;
};

export type Ticket = {
  id: number;
  token: string;
  guestName: string;
  refereeName: string;
  ticketType: string;
  createdAt: string;
  voidedAt: string | null;
};

function ticketFromRow(row: TicketRow): Ticket {
  return {
    id: row.id,
    token: row.token,
    guestName: row.guest_name,
    refereeName: row.referee_name,
    ticketType: row.ticket_type,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function generateTicketToken(): string {
  const token = `pt_${base64Url(crypto.getRandomValues(new Uint8Array(TOKEN_RANDOM_BYTES)))}`;
  if (!isTicketToken(token)) throw new Error("Generated invalid ticket token");
  return token;
}

function ticketSelect(): string {
  return `
    SELECT id, token, guest_name, referee_name, ticket_type, created_at, voided_at
    FROM tickets
  `;
}

function validateTicketInput(body: unknown): TicketInputResult {
  const input = typeof body === "object" && body !== null
    ? body as { guestName?: unknown; refereeName?: unknown; ticketType?: unknown }
    : {};
  const guestName = typeof input.guestName === "string"
    ? input.guestName.trim().replace(/\s+/g, " ")
    : "";
  const refereeName = typeof input.refereeName === "string"
    ? input.refereeName.trim().replace(/\s+/g, " ")
    : "";
  const ticketType = typeof input.ticketType === "string" ? input.ticketType.trim() : "";
  if (!guestName || guestName.length > MAX_GUEST_NAME_LENGTH) {
    return { valid: false, error: "invalid_guest_name" };
  }
  if (!refereeName || refereeName.length > MAX_REFEREE_NAME_LENGTH) {
    return { valid: false, error: "invalid_referee_name" };
  }
  if (!ticketTypes.includes(ticketType as (typeof ticketTypes)[number])) {
    return { valid: false, error: "invalid_ticket_type" };
  }
  return {
    valid: true,
    value: { guestName, refereeName, ticketType: ticketType as TicketInput["ticketType"] },
  };
}

async function createTicket(request: Request, env: Env): Promise<Response> {
  let body: { guestName?: unknown; refereeName?: unknown; ticketType?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const input = validateTicketInput(body);
  if (!input.valid) return json({ error: input.error }, 400);
  const { guestName, refereeName, ticketType } = input.value;

  for (let attempt = 0; attempt < TOKEN_INSERT_ATTEMPTS; attempt += 1) {
    const token = generateTicketToken();
    const created = await env.DB.prepare(`
      INSERT OR IGNORE INTO tickets (token, guest_name, referee_name, ticket_type)
      VALUES (?, ?, ?, ?)
      RETURNING id, token, guest_name, referee_name, ticket_type, created_at, voided_at
    `).bind(token, guestName, refereeName, ticketType).first<TicketRow>();
    if (created) return json({ ticket: ticketFromRow(created) }, 201);
  }
  return json({ error: "ticket_token_collision" }, 503);
}

async function updateTicket(id: number, request: Request, env: Env): Promise<Response> {
  let body: { guestName?: unknown; refereeName?: unknown; ticketType?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const input = validateTicketInput(body);
  if (!input.valid) return json({ error: input.error }, 400);
  const { guestName, refereeName, ticketType } = input.value;

  const updated = await env.DB.prepare(`
    UPDATE tickets
    SET guest_name = ?, referee_name = ?, ticket_type = ?
    WHERE id = ?
      AND (
        ticket_type = ?
        OR NOT EXISTS (
          SELECT 1
          FROM checkins
          WHERE checkins.ticket_id = tickets.id
        )
      )
    RETURNING id, token, guest_name, referee_name, ticket_type, created_at, voided_at
  `).bind(guestName, refereeName, ticketType, id, ticketType).first<TicketRow>();
  if (updated) return json({ ticket: ticketFromRow(updated) });

  const current = await env.DB.prepare(`${ticketSelect()} WHERE id = ?`).bind(id).first<TicketRow>();
  if (!current) return json({ error: "ticket_not_found" }, 404);
  return json({
    error: "ticket_type_locked",
    message: "Ticket type cannot be changed after check-in.",
  }, 409);
}

async function listTickets(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`${ticketSelect()} ORDER BY created_at DESC, id DESC LIMIT 500`)
    .all<TicketRow>();
  const referees = await env.DB.prepare(`
    SELECT DISTINCT referee_name
    FROM tickets
    WHERE referee_name <> ''
    ORDER BY referee_name COLLATE NOCASE
    LIMIT 200
  `).all<{ referee_name: string }>();
  return json({
    tickets: result.results.map(ticketFromRow),
    refereeNames: referees.results.map((row) => row.referee_name),
  });
}

async function getTicket(id: number, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`${ticketSelect()} WHERE id = ?`).bind(id).first<TicketRow>();
  return row ? json({ ticket: ticketFromRow(row) }) : json({ error: "ticket_not_found" }, 404);
}

async function cancelTicket(id: number, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`
    UPDATE tickets
    SET voided_at = COALESCE(voided_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE id = ?
    RETURNING id, token, guest_name, referee_name, ticket_type, created_at, voided_at
  `).bind(id).first<TicketRow>();
  return row ? json({ ticket: ticketFromRow(row) }) : json({ error: "ticket_not_found" }, 404);
}

async function restoreTicket(id: number, env: Env): Promise<Response> {
  const current = await env.DB.prepare(`${ticketSelect()} WHERE id = ?`).bind(id).first<TicketRow>();
  if (!current) return json({ error: "ticket_not_found" }, 404);
  if (!current.voided_at) return json({ ticket: ticketFromRow(current) });

  const restored = await env.DB.prepare(`
    UPDATE tickets
    SET voided_at = NULL
    WHERE id = ?
      AND voided_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM checkins
        WHERE checkins.ticket_id = tickets.id
      )
    RETURNING id, token, guest_name, referee_name, ticket_type, created_at, voided_at
  `).bind(id).first<TicketRow>();
  if (restored) return json({ ticket: ticketFromRow(restored) });

  return json({
    error: "ticket_already_checked_in",
    message: "A ticket that has already checked in cannot be restored.",
  }, 409);
}

export async function handleTicketRequest(request: Request, env: Env): Promise<Response | null> {
  const authorization = await requireRole(request, env, ADMIN_ONLY);
  if (isAuthResponse(authorization)) return authorization;

  const { pathname } = new URL(request.url);
  if (pathname === "/api/tickets") {
    if (request.method === "POST") {
      return isSameOriginRequest(request) ? createTicket(request, env) : json({ error: "forbidden" }, 403);
    }
    if (request.method === "GET") return listTickets(env);
    return methodNotAllowed(["GET", "POST"]);
  }

  const detailMatch = pathname.match(/^\/api\/tickets\/(\d+)$/);
  if (detailMatch) {
    const id = Number(detailMatch[1]);
    if (request.method === "GET") return getTicket(id, env);
    if (request.method === "PATCH") {
      return isSameOriginRequest(request) ? updateTicket(id, request, env) : json({ error: "forbidden" }, 403);
    }
    return methodNotAllowed(["GET", "PATCH"]);
  }

  const actionMatch = pathname.match(/^\/api\/tickets\/(\d+)\/(cancel|restore|void)$/);
  if (actionMatch) {
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
    const id = Number(actionMatch[1]);
    return actionMatch[2] === "restore" ? restoreTicket(id, env) : cancelTicket(id, env);
  }

  return null;
}
