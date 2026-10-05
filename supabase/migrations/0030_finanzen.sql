-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Abos und Fixkosten (Modul finanzen)
CREATE TABLE IF NOT EXISTS "abos" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "kategorie" text,
  "anbieter" text,
  "betrag" double precision,
  "intervall" text,
  "naechste_zahlung" date,
  "vertrag_bis" date,
  "kuendigungsfrist_monate" integer,
  "verlaengerung_monate" integer,
  "gekuendigt" boolean,
  "gekuendigt_am" date,
  "aktiv" boolean,
  "notiz" text
);
ALTER TABLE "abos" ENABLE ROW LEVEL SECURITY;

-- Rechnungen (Modul finanzen)
CREATE TABLE IF NOT EXISTS "rechnungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "kategorie" text,
  "betrag" double precision,
  "faellig" date,
  "bezahlt" boolean,
  "bezahlt_am" date,
  "notiz" text
);
ALTER TABLE "rechnungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_rechnungen_bezahlt_faellig" ON "rechnungen" ("bezahlt", "faellig");
