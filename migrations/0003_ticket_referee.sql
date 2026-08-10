ALTER TABLE tickets ADD COLUMN referee_name TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_tickets_referee_name
  ON tickets(referee_name COLLATE NOCASE);
