-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Parkhaus Messungen (Rohdaten) (Modul parken)
CREATE TABLE IF NOT EXISTS "park_messungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "ph_id" text,
  "frei" integer,
  "prozent" double precision,
  "offen" boolean
);
ALTER TABLE "park_messungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_park_messungen_ph_id_erstellt" ON "park_messungen" ("ph_id", "erstellt");
CREATE INDEX IF NOT EXISTS "idx_park_messungen_erstellt" ON "park_messungen" ("erstellt");

-- Parkhaus Belegung pro Stunde (Modul parken)
CREATE TABLE IF NOT EXISTS "park_stunden" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "zeit" timestamptz,
  "ph_id" text,
  "anzahl" integer,
  "prozent" double precision,
  "frei" double precision
);
ALTER TABLE "park_stunden" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_park_stunden_ph_id_zeit" ON "park_stunden" ("ph_id", "zeit");
CREATE INDEX IF NOT EXISTS "idx_park_stunden_zeit" ON "park_stunden" ("zeit");
