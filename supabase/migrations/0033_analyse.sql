-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Analyse Strafen (Modul analyse)
CREATE TABLE IF NOT EXISTS "analyse_strafen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "spiel_id" text,
  "team" text,
  "spieler_id" text,
  "minuten" integer,
  "drittel" integer,
  "minute" integer,
  "zeit_sek" integer,
  "ende_sek" integer
);
ALTER TABLE "analyse_strafen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_analyse_strafen_spiel_id" ON "analyse_strafen" ("spiel_id");
