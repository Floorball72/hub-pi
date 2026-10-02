-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Einstellungen (Modul kern)
CREATE TABLE IF NOT EXISTS "einstellungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "wert" jsonb
);
ALTER TABLE "einstellungen" ENABLE ROW LEVEL SECURITY;

-- Aktivitätslog (Modul kern)
CREATE TABLE IF NOT EXISTS "aktivitaet" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "modul" text,
  "art" text,
  "text" text
);
ALTER TABLE "aktivitaet" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_aktivitaet_erstellt" ON "aktivitaet" ("erstellt");

-- Alarmregeln (Modul kern)
CREATE TABLE IF NOT EXISTS "alarm_regeln" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "modul" text,
  "name" text,
  "beschreibung" text,
  "aktiv" boolean,
  "prioritaet" integer,
  "schwelle" double precision,
  "schwelle_label" text,
  "ruhe_von" text,
  "ruhe_bis" text,
  "nachts" boolean,
  "cooldown_min" integer
);
ALTER TABLE "alarm_regeln" ENABLE ROW LEVEL SECURITY;

-- Alarme (Modul kern)
CREATE TABLE IF NOT EXISTS "alarme" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "regel" text,
  "modul" text,
  "titel" text,
  "text" text,
  "prioritaet" integer,
  "status" text,
  "grund" text,
  "schluessel" text,
  "wert" double precision
);
ALTER TABLE "alarme" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_alarme_erstellt" ON "alarme" ("erstellt");
CREATE INDEX IF NOT EXISTS "idx_alarme_schluessel" ON "alarme" ("schluessel");
