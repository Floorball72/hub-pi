-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Normalbereiche (Modul auffaelligkeiten)
CREATE TABLE IF NOT EXISTS "metrik_basis" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "metrik" text,
  "eimer" text,
  "median" double precision,
  "mad" double precision,
  "n" integer,
  "erster" timestamptz
);
ALTER TABLE "metrik_basis" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_metrik_basis_metrik" ON "metrik_basis" ("metrik");

-- Auffälligkeiten (Modul auffaelligkeiten)
CREATE TABLE IF NOT EXISTS "metrik_ereignisse" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "metrik" text,
  "start" timestamptz,
  "ende" timestamptz,
  "wert" double precision,
  "median" double precision,
  "z" double precision,
  "richtung" text,
  "rueckmeldung" text
);
ALTER TABLE "metrik_ereignisse" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_metrik_ereignisse_metrik_start" ON "metrik_ereignisse" ("metrik", "start");
