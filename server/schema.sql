-- Sede — registration + trial-serial backend schema (D1 / SQLite).
-- Applied once via `npm run db:init:local` (local dev) or
-- `npm run db:init:remote` (the real, deployed database) — see README.md.

CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  serial TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  redeemed_at TEXT,
  redeemed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_registrations_serial ON registrations(serial);
CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
