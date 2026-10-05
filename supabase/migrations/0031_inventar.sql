-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Inventar (Modul inventar)
CREATE TABLE IF NOT EXISTS "gegenstaende" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "kategorie" text,
  "ort" text,
  "marke" text,
  "modell" text,
  "seriennummer" text,
  "gekauft_am" date,
  "preis" double precision,
  "haendler" text,
  "garantie_monate" integer,
  "garantie_bis" date,
  "beleg" text,
  "wartung_monate" integer,
  "wartung_text" text,
  "letzte_wartung" date,
  "ausgemustert" boolean,
  "notiz" text
);
ALTER TABLE "gegenstaende" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_gegenstaende_ausgemustert" ON "gegenstaende" ("ausgemustert");
