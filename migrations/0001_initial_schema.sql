PRAGMA foreign_keys = ON;

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE CHECK (length(token) >= 16),
  guest_name TEXT NOT NULL CHECK (length(trim(guest_name)) > 0),
  ticket_type TEXT NOT NULL CHECK (length(trim(ticket_type)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  voided_at TEXT
);

CREATE INDEX idx_tickets_guest_name
  ON tickets(guest_name COLLATE NOCASE);

CREATE INDEX idx_tickets_created_at
  ON tickets(created_at);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL UNIQUE,
  scanner_role TEXT NOT NULL CHECK (
    scanner_role IN ('ADMIN', 'PRIMARY_SCANNER', 'SECONDARY_SCANNER')
  ),
  checked_in_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source TEXT NOT NULL CHECK (source IN ('QR', 'MANUAL', 'OFFLINE')),
  client_operation_id TEXT UNIQUE,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_checkins_checked_in_at
  ON checkins(checked_in_at);
