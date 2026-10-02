-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Dienste (Modul dienste)
CREATE TABLE IF NOT EXISTS "dienste" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "art" text,
  "url" text,
  "aktiv" boolean,
  "push" boolean,
  "hostet_seiten" boolean
);
ALTER TABLE "dienste" ENABLE ROW LEVEL SECURITY;

-- Dienste Verlauf (Modul dienste)
CREATE TABLE IF NOT EXISTS "dienste_verlauf" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "dienst_id" text,
  "stufe" text,
  "text" text
);
ALTER TABLE "dienste_verlauf" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_dienste_verlauf_dienst_id_erstellt" ON "dienste_verlauf" ("dienst_id", "erstellt");
