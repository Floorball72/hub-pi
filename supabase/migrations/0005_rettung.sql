-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Helikopter Kennzeichen (Modul rettung)
CREATE TABLE IF NOT EXISTS "heli_kennungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "organisation" text,
  "muster" text,
  "push" boolean,
  "notizen" text
);
ALTER TABLE "heli_kennungen" ENABLE ROW LEVEL SECURITY;

-- Erfasste Helikopterflüge (Modul rettung)
CREATE TABLE IF NOT EXISTS "heli_fluege" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "hex" text,
  "kennzeichen" text,
  "typ" text,
  "organisation" text,
  "start" timestamptz,
  "start_art" text,
  "start_lat" double precision,
  "start_lon" double precision,
  "start_ort" text,
  "ende" timestamptz,
  "ende_art" text,
  "ende_lat" double precision,
  "ende_lon" double precision,
  "ende_ort" text,
  "max_hoehe_ft" integer,
  "spur" jsonb
);
ALTER TABLE "heli_fluege" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_heli_fluege_start" ON "heli_fluege" ("start");
CREATE INDEX IF NOT EXISTS "idx_heli_fluege_organisation_start" ON "heli_fluege" ("organisation", "start");

-- Einsatzmeldungen (Modul rettung)
CREATE TABLE IF NOT EXISTS "einsatz_meldungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "quelle" text,
  "titel" text,
  "link" text,
  "zeit" timestamptz,
  "kategorie" text,
  "text" text
);
ALTER TABLE "einsatz_meldungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_einsatz_meldungen_zeit" ON "einsatz_meldungen" ("zeit");
CREATE INDEX IF NOT EXISTS "idx_einsatz_meldungen_link" ON "einsatz_meldungen" ("link");

-- Webcams (Modul rettung)
CREATE TABLE IF NOT EXISTS "webcams" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "lat" double precision,
  "lon" double precision,
  "bild_url" text,
  "link" text
);
ALTER TABLE "webcams" ENABLE ROW LEVEL SECURITY;
