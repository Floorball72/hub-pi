-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Flug Logbuch (Modul drohne)
CREATE TABLE IF NOT EXISTS "drohnen_fluege" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "datum" timestamptz,
  "dauer_min" double precision,
  "drohne" text,
  "ort_id" text,
  "dreh_id" text,
  "akku_id" text,
  "kategorie" text,
  "max_hoehe_m" integer,
  "zweck" text,
  "notizen" text
);
ALTER TABLE "drohnen_fluege" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_drohnen_fluege_datum" ON "drohnen_fluege" ("datum");

-- Akkus (Modul drohne)
CREATE TABLE IF NOT EXISTS "akkus" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "drohne" text,
  "kaufdatum" date,
  "zyklen_start" integer,
  "zyklen_max" integer,
  "status" text,
  "notizen" text
);
ALTER TABLE "akkus" ENABLE ROW LEVEL SECURITY;

-- Wartungslog (Modul drohne)
CREATE TABLE IF NOT EXISTS "wartung" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "datum" date,
  "gegenstand" text,
  "arbeit" text,
  "naechste" date,
  "notizen" text
);
ALTER TABLE "wartung" ENABLE ROW LEVEL SECURITY;

-- Dokumente und Fristen (Modul drohne)
CREATE TABLE IF NOT EXISTS "drohnen_dokumente" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "art" text,
  "nummer" text,
  "ablauf" date,
  "notizen" text
);
ALTER TABLE "drohnen_dokumente" ENABLE ROW LEVEL SECURITY;
