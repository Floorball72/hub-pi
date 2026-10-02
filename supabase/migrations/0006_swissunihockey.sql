-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Checkliste Vorlage (Modul swissunihockey)
CREATE TABLE IF NOT EXISTS "suh_vorlage" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "abschnitt" text,
  "text" text,
  "fuer" text,
  "reihenfolge" integer
);
ALTER TABLE "suh_vorlage" ENABLE ROW LEVEL SECURITY;

-- Checkliste pro Einsatz (Modul swissunihockey)
CREATE TABLE IF NOT EXISTS "suh_einsatz" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "schluessel" text,
  "erledigt" jsonb,
  "notizen" text
);
ALTER TABLE "suh_einsatz" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_suh_einsatz_schluessel" ON "suh_einsatz" ("schluessel");
