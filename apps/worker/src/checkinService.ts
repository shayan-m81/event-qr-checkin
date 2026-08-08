import type { Env, Role } from "./types";

export type CheckinSource = "QR" | "MANUAL" | "OFFLINE";

export type CheckinResult = {
  state: "VALID" | "ALREADY_USED" | "INVALID" | "VOIDED";
  guestName?: string;
  ticketType?: string;
  checkedInAt?: string;
  checkedInCount: number;
  idempotentReplay?: boolean;
};

type TicketForCheckin = {
  id: number;
  guest_name: string;
  ticket_type: string;
  voided_at: string | null;
};

type CheckinTime = {
  checked_in_at: string;
};

type ExistingCheckin = {
  ticket_id: number;
  guest_name: string;
  ticket_type: string;
  checked_in_at: string;
};

type CheckinTarget =
  | { token: string; ticketId?: never }
  | { ticketId: number; token?: never };

type PerformCheckinOptions = CheckinTarget & {
  env: Env;
  actorRole: Role;
  source: CheckinSource;
  clientOperationId?: string;
};

async function checkedInCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM checkins").first<{ count: number }>();
  return row?.count ?? 0;
}

async function findTicket(target: CheckinTarget, env: Env): Promise<TicketForCheckin | null> {
  if (target.token !== undefined) {
    return env.DB.prepare(`
      SELECT id, guest_name, ticket_type, voided_at
      FROM tickets
      WHERE token = ?
    `).bind(target.token).first<TicketForCheckin>();
  }
  return env.DB.prepare(`
    SELECT id, guest_name, ticket_type, voided_at
    FROM tickets
    WHERE id = ?
  `).bind(target.ticketId).first<TicketForCheckin>();
}

async function existingCheckin(ticketId: number, env: Env): Promise<ExistingCheckin | null> {
  return env.DB.prepare(`
    SELECT checkins.ticket_id, tickets.guest_name, tickets.ticket_type, checkins.checked_in_at
    FROM checkins
    INNER JOIN tickets ON tickets.id = checkins.ticket_id
    WHERE checkins.ticket_id = ?
  `).bind(ticketId).first<ExistingCheckin>();
}

async function existingOperation(clientOperationId: string, env: Env): Promise<ExistingCheckin | null> {
  return env.DB.prepare(`
    SELECT checkins.ticket_id, tickets.guest_name, tickets.ticket_type, checkins.checked_in_at
    FROM checkins
    INNER JOIN tickets ON tickets.id = checkins.ticket_id
    WHERE checkins.client_operation_id = ?
  `).bind(clientOperationId).first<ExistingCheckin>();
}

export async function performCheckin(options: PerformCheckinOptions): Promise<CheckinResult> {
  const { env, actorRole, source, clientOperationId = null } = options;
  const ticket = await findTicket(options, env);
  if (!ticket) return { state: "INVALID", checkedInCount: await checkedInCount(env) };
  if (clientOperationId) {
    const replay = await existingOperation(clientOperationId, env);
    if (replay) {
      if (replay.ticket_id !== ticket.id) {
        return { state: "INVALID", checkedInCount: await checkedInCount(env) };
      }
      return {
        state: "VALID",
        guestName: replay.guest_name,
        ticketType: replay.ticket_type,
        checkedInAt: replay.checked_in_at,
        checkedInCount: await checkedInCount(env),
        idempotentReplay: true,
      };
    }
  }
  if (ticket.voided_at) {
    return {
      state: "VOIDED",
      guestName: ticket.guest_name,
      ticketType: ticket.ticket_type,
      checkedInCount: await checkedInCount(env),
    };
  }

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO checkins (ticket_id, scanner_role, source, client_operation_id)
      SELECT id, ?, ?, ?
      FROM tickets
      WHERE id = ? AND voided_at IS NULL
      RETURNING checked_in_at
    `).bind(actorRole, source, clientOperationId, ticket.id).first<CheckinTime>();

    if (!inserted) {
      return {
        state: "VOIDED",
        guestName: ticket.guest_name,
        ticketType: ticket.ticket_type,
        checkedInCount: await checkedInCount(env),
      };
    }
    return {
      state: "VALID",
      guestName: ticket.guest_name,
      ticketType: ticket.ticket_type,
      checkedInAt: inserted.checked_in_at,
      checkedInCount: await checkedInCount(env),
    };
  } catch (error) {
    if (clientOperationId) {
      const replay = await existingOperation(clientOperationId, env);
      if (replay) {
        if (replay.ticket_id !== ticket.id) {
          return { state: "INVALID", checkedInCount: await checkedInCount(env) };
        }
        return {
          state: "VALID",
          guestName: replay.guest_name,
          ticketType: replay.ticket_type,
          checkedInAt: replay.checked_in_at,
          checkedInCount: await checkedInCount(env),
          idempotentReplay: true,
        };
      }
    }
    const existing = await existingCheckin(ticket.id, env);
    if (!existing) throw error;
    return {
      state: "ALREADY_USED",
      guestName: existing.guest_name,
      ticketType: existing.ticket_type,
      checkedInAt: existing.checked_in_at,
      checkedInCount: await checkedInCount(env),
    };
  }
}
