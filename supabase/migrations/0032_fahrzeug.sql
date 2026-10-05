-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Fahrzeuge (Modul fahrzeug)
CREATE TABLE IF NOT EXISTS "fahrzeuge" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "kennzeichen" text,
  "modell" text,
  "treibstoff" text,
  "km_stand" integer,
  "km_stand_am" date,
  "mfk_faellig" date,
  "service_monate" integer,
  "service_km" integer,
  "letzter_service_datum" date,
  "letzter_service_km" integer,
  "reifen_montiert" text,
  "vignette_jahr" integer,
  "aktiv" boolean,
  "notiz" text
);
ALTER TABLE "fahrzeuge" ENABLE ROW LEVEL SECURITY;

-- Tankungen (Modul fahrzeug)
CREATE TABLE IF NOT EXISTS "tankungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "fahrzeug_id" text,
  "datum" date,
  "km" integer,
  "liter" double precision,
  "betrag" double precision,
  "voll" boolean,
  "notiz" text
);
ALTER TABLE "tankungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_tankungen_fahrzeug_id_datum" ON "tankungen" ("fahrzeug_id", "datum");

-- Service und Reparaturen (Modul fahrzeug)
CREATE TABLE IF NOT EXISTS "fahrzeug_eintraege" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "fahrzeug_id" text,
  "datum" date,
  "art" text,
  "km" integer,
  "kosten" double precision,
  "notiz" text
);
ALTER TABLE "fahrzeug_eintraege" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_fahrzeug_eintraege_fahrzeug_id_datum" ON "fahrzeug_eintraege" ("fahrzeug_id", "datum");
