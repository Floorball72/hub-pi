-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

ALTER TABLE "heli_fluege" ADD COLUMN IF NOT EXISTS "start_platz" text;
ALTER TABLE "heli_fluege" ADD COLUMN IF NOT EXISTS "ende_platz" text;
