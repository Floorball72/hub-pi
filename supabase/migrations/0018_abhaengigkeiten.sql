-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Projekte (Modul abhaengigkeiten)
CREATE TABLE IF NOT EXISTS "abh_projekte" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "quelle" text,
  "ort" text,
  "zweig" text,
  "unterordner" text,
  "aktiv" boolean
);
ALTER TABLE "abh_projekte" ENABLE ROW LEVEL SECURITY;

-- Funde (Modul abhaengigkeiten)
CREATE TABLE IF NOT EXISTS "abh_funde" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "projekt_id" text,
  "paket" text,
  "version" text,
  "direkt" boolean,
  "vuln_id" text,
  "aliase" text,
  "titel" text,
  "schwere" text,
  "behoben_in" text
);
ALTER TABLE "abh_funde" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_abh_funde_projekt_id" ON "abh_funde" ("projekt_id");

-- Prüfläufe (Modul abhaengigkeiten)
CREATE TABLE IF NOT EXISTS "abh_laeufe" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "projekt_id" text,
  "pakete" integer,
  "funde" integer,
  "neu" integer,
  "behoben" integer,
  "genau" boolean,
  "fehler" text
);
ALTER TABLE "abh_laeufe" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_abh_laeufe_projekt_id_erstellt" ON "abh_laeufe" ("projekt_id", "erstellt");
