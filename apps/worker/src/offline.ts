import { isAuthResponse, requireRole } from "./auth";
import { performCheckin } from "./checkinService";
import { isSameOriginRequest, json, methodNotAllowed } from "./http";
import type { Env } from "./types";
import { logServerEvent } from "./logging";
import { isTicketToken } from "./ticketToken";
import { ADMIN_ONLY, PRIMARY_OFFLINE_ONLY, READINESS_ROLES } from "./permissions";

const MAX_OPERATIONS = 100;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type SnapshotRow = {
  id: number;
  token: string;
  guest_name: string;
  ticket_type: string;
  voided_at: string | null;
  checked_in_at: string | null;
};

type SyncOperation = {
  clientOperationId: string;
  token: string;
  checkedInAt: string;
};

function validOperation(value: unknown): value is SyncOperation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SyncOperation>;
  return typeof item.clientOperationId === "string"
    && OPERATION_ID_PATTERN.test(item.clientOperationId)
    && isTicketToken(item.token)
    && typeof item.checkedInAt === "string"
    && item.checkedInAt.length <= 40
    && !Number.isNaN(Date.parse(item.checkedInAt));
}

async function snapshot(request: Request, env: Env): Promise<Response> {
  const auth = await requireRole(request, env, READINESS_ROLES);
  if (isAuthResponse(auth)) return auth;
  const rows = await env.DB.prepare(`
    SELECT tickets.id, tickets.token, tickets.guest_name, tickets.ticket_type,
      tickets.voided_at, checkins.checked_in_at
    FROM tickets
    LEFT JOIN checkins ON checkins.ticket_id = tickets.id
    ORDER BY tickets.id
  `).all<SnapshotRow>();
  return json({
    generatedAt: new Date().toISOString(),
    tickets: rows.results.map((row) => ({
      ticketId: row.id,
      token: row.token,
      guestName: row.guest_name,
      ticketType: row.ticket_type,
      voidedAt: row.voided_at,
      checkedInAt: row.checked_in_at,
    })),
  });
}

async function saveConflict(operation: SyncOperation, ticketId: number, existingCheckedInAt: string, env: Env) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO offline_conflicts
      (client_operation_id, ticket_id, local_checked_in_at, existing_checked_in_at)
    VALUES (?, ?, ?, ?)
  `).bind(operation.clientOperationId, ticketId, operation.checkedInAt, existingCheckedInAt).run();
}

async function sync(request: Request, env: Env): Promise<Response> {
  const auth = await requireRole(request, env, PRIMARY_OFFLINE_ONLY);
  if (isAuthResponse(auth)) return auth;
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);

  let operations: unknown;
  try {
    operations = (await request.json() as { operations?: unknown }).operations;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS
    || !operations.every(validOperation)
    || new Set(operations.map((operation) => operation.clientOperationId)).size !== operations.length) {
    return json({ error: "invalid_request" }, 400);
  }

  const results = [];
  for (const operation of operations) {
    const ticket = await env.DB.prepare("SELECT id FROM tickets WHERE token = ?")
      .bind(operation.token).first<{ id: number }>();
    const result = await performCheckin({
      env,
      token: operation.token,
      actorRole: auth.role,
      source: "OFFLINE",
      clientOperationId: operation.clientOperationId,
    });
    if (result.state === "ALREADY_USED" && ticket && result.checkedInAt) {
      await saveConflict(operation, ticket.id, result.checkedInAt, env);
      logServerEvent("warn", "offline_sync_conflict", { operationId: operation.clientOperationId });
    }
    results.push({
      clientOperationId: operation.clientOperationId,
      acknowledged: true,
      outcome: result.state === "VALID"
        ? result.idempotentReplay ? "IDEMPOTENT_REPLAY" : "APPLIED"
        : result.state === "ALREADY_USED" ? "CONFLICT" : result.state,
      guestName: result.guestName,
      checkedInAt: result.checkedInAt,
    });
  }
  return json({ results });
}

async function conflicts(request: Request, env: Env): Promise<Response> {
  const auth = await requireRole(request, env, ADMIN_ONLY);
  if (isAuthResponse(auth)) return auth;
  const rows = await env.DB.prepare(`
    SELECT offline_conflicts.client_operation_id, offline_conflicts.local_checked_in_at,
      offline_conflicts.existing_checked_in_at, offline_conflicts.detected_at,
      tickets.id AS ticket_id, tickets.guest_name, tickets.ticket_type
    FROM offline_conflicts
    INNER JOIN tickets ON tickets.id = offline_conflicts.ticket_id
    ORDER BY offline_conflicts.detected_at DESC
    LIMIT 200
  `).all();
  return json({ conflicts: rows.results });
}

export async function handleOfflineRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/offline/snapshot") {
    return request.method === "GET" ? snapshot(request, env) : methodNotAllowed(["GET"]);
  }
  if (pathname === "/api/offline/sync") {
    return request.method === "POST" ? sync(request, env) : methodNotAllowed(["POST"]);
  }
  if (pathname === "/api/offline/conflicts") {
    return request.method === "GET" ? conflicts(request, env) : methodNotAllowed(["GET"]);
  }
  return null;
}
