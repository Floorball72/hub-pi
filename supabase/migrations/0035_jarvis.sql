-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Gedächtnis (Modul jarvis)
CREATE TABLE IF NOT EXISTS "jarvis_gedaechtnis" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "kategorie" text,
  "inhalt" text,
  "wichtigkeit" integer,
  "quelle" text
);
ALTER TABLE "jarvis_gedaechtnis" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_jarvis_gedaechtnis_wichtigkeit" ON "jarvis_gedaechtnis" ("wichtigkeit");

-- Jarvis Gespräche (Modul jarvis)
CREATE TABLE IF NOT EXISTS "jarvis_gespraeche" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text
);
ALTER TABLE "jarvis_gespraeche" ENABLE ROW LEVEL SECURITY;

-- Jarvis Nachrichten (Modul jarvis)
CREATE TABLE IF NOT EXISTS "jarvis_nachrichten" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "gespraech_id" text,
  "rolle" text,
  "inhalt" jsonb
);
ALTER TABLE "jarvis_nachrichten" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_jarvis_nachrichten_gespraech_id_erstellt" ON "jarvis_nachrichten" ("gespraech_id", "erstellt");

-- Jarvis Nutzung (Modul jarvis)
CREATE TABLE IF NOT EXISTS "jarvis_nutzung" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "modell" text,
  "tokens_ein" integer,
  "tokens_aus" integer
);
ALTER TABLE "jarvis_nutzung" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_jarvis_nutzung_erstellt" ON "jarvis_nutzung" ("erstellt");
