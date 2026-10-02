-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Drohnen Orte (Modul drohne)
CREATE TABLE IF NOT EXISTS "drohnen_orte" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "lat" double precision,
  "lon" double precision,
  "status" text,
  "shortlist" boolean,
  "dreh_id" text,
  "notizen" text,
  "wetterfenster_alarm" boolean,
  "flughoehe_m" integer,
  "wind_max_kmh" double precision,
  "boeen_max_kmh" double precision,
  "niederschlag_max_mm" double precision,
  "sicht_min_m" double precision,
  "temp_min" double precision,
  "temp_max" double precision,
  "kp_max" double precision
);
ALTER TABLE "drohnen_orte" ENABLE ROW LEVEL SECURITY;

-- Kundendrehs (Modul drohne)
CREATE TABLE IF NOT EXISTS "drehs" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "kunde_id" text,
  "ort_id" text,
  "termin" timestamptz,
  "status" text,
  "frist" date,
  "drehbuch" text,
  "notizen" text
);
ALTER TABLE "drehs" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_drehs_termin" ON "drehs" ("termin");
