-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Beobachtete Seiten (Modul aenderungen)
CREATE TABLE IF NOT EXISTS "aend_seiten" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "url" text,
  "kunde_id" text,
  "intervall_std" integer,
  "ausnahmen" text,
  "aktiv" boolean
);
ALTER TABLE "aend_seiten" ENABLE ROW LEVEL SECURITY;

-- Momentaufnahmen (Modul aenderungen)
CREATE TABLE IF NOT EXISTS "aend_snapshots" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "hash" text,
  "basis" boolean,
  "daten" jsonb
);
ALTER TABLE "aend_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_aend_snapshots_seite_id_basis" ON "aend_snapshots" ("seite_id", "basis");

-- Erkannte Änderungen (Modul aenderungen)
CREATE TABLE IF NOT EXISTS "aend_meldungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "hash" text,
  "gewicht" text,
  "zusammenfassung" text,
  "unterschiede" jsonb,
  "status" text
);
ALTER TABLE "aend_meldungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_aend_meldungen_seite_id_erstellt" ON "aend_meldungen" ("seite_id", "erstellt");
CREATE INDEX IF NOT EXISTS "idx_aend_meldungen_status" ON "aend_meldungen" ("status");
