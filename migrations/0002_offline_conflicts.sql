PRAGMA foreign_keys = ON;

CREATE TABLE offline_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_operation_id TEXT NOT NULL UNIQUE,
  ticket_id INTEGER NOT NULL,
  local_checked_in_at TEXT NOT NULL,
  existing_checked_in_at TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_offline_conflicts_detected_at
  ON offline_conflicts(detected_at);
