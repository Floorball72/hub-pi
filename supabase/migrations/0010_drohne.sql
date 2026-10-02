-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Bewertungen Sonnenauf und untergang (Modul drohne)
CREATE TABLE IF NOT EXISTS "sonnen_bewertungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "ort_id" text,
  "datum" date,
  "ereignis" text,
  "score" integer,
  "faktoren" jsonb,
  "bewertung" integer
);
ALTER TABLE "sonnen_bewertungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_sonnen_bewertungen_ort_id_datum" ON "sonnen_bewertungen" ("ort_id", "datum");
