-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Beiträge (Modul content)
CREATE TABLE IF NOT EXISTS "content_beitraege" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "zeit" timestamptz,
  "plattform" text,
  "art" text,
  "status" text,
  "notizen" text,
  "checkliste" jsonb,
  "event_id" text,
  "kunde_id" text,
  "erinnerung_min" integer
);
ALTER TABLE "content_beitraege" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_content_beitraege_zeit" ON "content_beitraege" ("zeit");
