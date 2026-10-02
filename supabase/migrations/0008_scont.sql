-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Zeiterfassung (Modul scont)
CREATE TABLE IF NOT EXISTS "zeiten" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "kunde_id" text,
  "start" timestamptz,
  "ende" timestamptz,
  "minuten" double precision,
  "beschreibung" text
);
ALTER TABLE "zeiten" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_zeiten_kunde_id_start" ON "zeiten" ("kunde_id", "start");
