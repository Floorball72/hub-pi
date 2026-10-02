-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Wetterprüfungen der Drehs (Modul drehwetter)
CREATE TABLE IF NOT EXISTS "dreh_wetter" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "dreh_id" text,
  "stufe" text,
  "ok" boolean,
  "gruende" jsonb,
  "alternativen" jsonb
);
ALTER TABLE "dreh_wetter" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_dreh_wetter_dreh_id_erstellt" ON "dreh_wetter" ("dreh_id", "erstellt");
