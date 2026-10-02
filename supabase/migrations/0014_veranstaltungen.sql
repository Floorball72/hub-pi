-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Quellen (Modul veranstaltungen)
CREATE TABLE IF NOT EXISTS "veranstaltung_quellen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "url" text,
  "art" text,
  "kategorie" text,
  "ort_name" text,
  "lat" double precision,
  "lon" double precision,
  "nutzung_geprueft" boolean,
  "aktiv" boolean
);
ALTER TABLE "veranstaltung_quellen" ENABLE ROW LEVEL SECURITY;

-- Anlässe (Modul veranstaltungen)
CREATE TABLE IF NOT EXISTS "veranstaltungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "quelle_id" text,
  "uid" text,
  "titel" text,
  "start" timestamptz,
  "ende" timestamptz,
  "ort" text,
  "link" text,
  "kategorie" text,
  "lat" double precision,
  "lon" double precision
);
ALTER TABLE "veranstaltungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_veranstaltungen_start" ON "veranstaltungen" ("start");
CREATE INDEX IF NOT EXISTS "idx_veranstaltungen_uid" ON "veranstaltungen" ("uid");
