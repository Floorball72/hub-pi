-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Teams (Modul teams)
CREATE TABLE IF NOT EXISTS "sport_teams" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "sport" text,
  "quelle" text,
  "team_id" text,
  "liga" text,
  "saison" text,
  "push_spielende" boolean,
  "aktiv" boolean
);
ALTER TABLE "sport_teams" ENABLE ROW LEVEL SECURITY;
