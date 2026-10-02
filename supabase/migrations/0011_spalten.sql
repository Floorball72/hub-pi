-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

ALTER TABLE "drohnen_orte" ADD COLUMN IF NOT EXISTS "sonnen_alarm" boolean;
