-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Aufgaben (Modul aufgaben)
CREATE TABLE IF NOT EXISTS "aufgaben" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "notiz" text,
  "liste" text,
  "faellig" date,
  "uhrzeit" text,
  "prioritaet" text,
  "rhythmus" text,
  "erledigt" boolean,
  "erledigt_am" timestamptz
);
ALTER TABLE "aufgaben" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_aufgaben_erledigt_faellig" ON "aufgaben" ("erledigt", "faellig");

-- Routinen (Modul aufgaben)
CREATE TABLE IF NOT EXISTS "routinen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "schritte" text,
  "rhythmus" text,
  "tage" text,
  "uhrzeit" text,
  "aktiv" boolean
);
ALTER TABLE "routinen" ENABLE ROW LEVEL SECURITY;

-- Routinen Verlauf (Modul aufgaben)
CREATE TABLE IF NOT EXISTS "routinen_laeufe" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "routine_id" text,
  "periode" date,
  "erledigt" jsonb,
  "fertig" boolean
);
ALTER TABLE "routinen_laeufe" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_routinen_laeufe_routine_id_periode" ON "routinen_laeufe" ("routine_id", "periode");

-- Einkaufsliste (Modul aufgaben)
CREATE TABLE IF NOT EXISTS "einkauf" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "text" text,
  "menge" text,
  "erledigt" boolean
);
ALTER TABLE "einkauf" ENABLE ROW LEVEL SECURITY;
