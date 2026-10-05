-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

ALTER TABLE "analyse_spiele" ADD COLUMN IF NOT EXISTS "drittel_min" integer;
ALTER TABLE "analyse_spieler" ADD COLUMN IF NOT EXISTS "block" integer;
ALTER TABLE "analyse_ereignisse" ADD COLUMN IF NOT EXISTS "auf_feld" text;
ALTER TABLE "analyse_ereignisse" ADD COLUMN IF NOT EXISTS "zeit_sek" integer;
