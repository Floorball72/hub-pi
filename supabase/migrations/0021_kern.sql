-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Metriken (Rohwerte) (Modul kern)
CREATE TABLE IF NOT EXISTS "metrik_werte" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "metrik" text,
  "wert" double precision
);
ALTER TABLE "metrik_werte" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_metrik_werte_metrik_erstellt" ON "metrik_werte" ("metrik", "erstellt");
CREATE INDEX IF NOT EXISTS "idx_metrik_werte_erstellt" ON "metrik_werte" ("erstellt");

-- Metriken pro Stunde (Modul kern)
CREATE TABLE IF NOT EXISTS "metrik_stunden" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "zeit" timestamptz,
  "metrik" text,
  "anzahl" integer,
  "wert" double precision
);
ALTER TABLE "metrik_stunden" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_metrik_stunden_metrik_zeit" ON "metrik_stunden" ("metrik", "zeit");
CREATE INDEX IF NOT EXISTS "idx_metrik_stunden_zeit" ON "metrik_stunden" ("zeit");
