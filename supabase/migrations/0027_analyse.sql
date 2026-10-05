-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Analyse Spiele (Modul analyse)
CREATE TABLE IF NOT EXISTS "analyse_spiele" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "datum" date,
  "gegner" text,
  "team" text,
  "ort" text,
  "saison" text,
  "notiz" text
);
ALTER TABLE "analyse_spiele" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_analyse_spiele_datum" ON "analyse_spiele" ("datum");

-- Analyse Spieler (Modul analyse)
CREATE TABLE IF NOT EXISTS "analyse_spieler" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "nummer" integer,
  "name" text,
  "position" text,
  "aktiv" boolean
);
ALTER TABLE "analyse_spieler" ENABLE ROW LEVEL SECURITY;

-- Analyse Abschlüsse (Modul analyse)
CREATE TABLE IF NOT EXISTS "analyse_ereignisse" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "spiel_id" text,
  "typ" text,
  "team" text,
  "x" double precision,
  "y" double precision,
  "spieler_id" text,
  "assist_id" text,
  "drittel" integer,
  "minute" integer,
  "situation" text
);
ALTER TABLE "analyse_ereignisse" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_analyse_ereignisse_spiel_id" ON "analyse_ereignisse" ("spiel_id");
