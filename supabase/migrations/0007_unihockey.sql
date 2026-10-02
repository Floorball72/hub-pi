-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Unihockey Teams (Modul unihockey)
CREATE TABLE IF NOT EXISTS "teams" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "team_id" text,
  "saison" integer,
  "favorit" boolean,
  "push_spielende" boolean
);
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
