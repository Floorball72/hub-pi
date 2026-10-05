-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Smart Home Geräte (Modul smarthome)
CREATE TABLE IF NOT EXISTS "smarthome_geraete" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "raum" text,
  "typ" text,
  "adapter" text,
  "adresse" text,
  "kanal" integer,
  "an_url" text,
  "aus_url" text,
  "status_url" text,
  "status_feld" text,
  "favorit" boolean,
  "bestaetigen" boolean
);
ALTER TABLE "smarthome_geraete" ENABLE ROW LEVEL SECURITY;

-- Smart Home Zeitpläne (Modul smarthome)
CREATE TABLE IF NOT EXISTS "smarthome_zeitplaene" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "geraet_id" text,
  "aktion" text,
  "art" text,
  "uhrzeit" text,
  "versatz_min" integer,
  "tage" text,
  "aktiv" boolean
);
ALTER TABLE "smarthome_zeitplaene" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_smarthome_zeitplaene_geraet_id" ON "smarthome_zeitplaene" ("geraet_id");

-- Smart Home Szenen (Modul smarthome)
CREATE TABLE IF NOT EXISTS "smarthome_szenen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "zustaende" jsonb
);
ALTER TABLE "smarthome_szenen" ENABLE ROW LEVEL SECURITY;
