-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Schnellnotizen (Modul zentrale)
CREATE TABLE IF NOT EXISTS "notizen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "text" text,
  "bezug_typ" text,
  "bezug_id" text,
  "bezug_name" text,
  "angeheftet" boolean
);
ALTER TABLE "notizen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_notizen_bezug_typ_bezug_id" ON "notizen" ("bezug_typ", "bezug_id");
