-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

ALTER TABLE "drehs" ADD COLUMN IF NOT EXISTS "dauer_min" integer;
