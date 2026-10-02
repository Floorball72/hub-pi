-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Veranstaltungen (Modul events)
CREATE TABLE IF NOT EXISTS "events" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "titel" text,
  "start" timestamptz,
  "ende" timestamptz,
  "ort_name" text,
  "lat" double precision,
  "lon" double precision,
  "typ" text,
  "status" text,
  "kunde_id" text,
  "link" text,
  "notizen" text
);
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_events_start" ON "events" ("start");

-- Ablaufplan (Modul events)
CREATE TABLE IF NOT EXISTS "event_ablauf" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "event_id" text,
  "zeit" timestamptz,
  "dauer_min" integer,
  "text" text,
  "rolle" text
);
ALTER TABLE "event_ablauf" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_event_ablauf_event_id" ON "event_ablauf" ("event_id");

-- Aufgaben (Modul events)
CREATE TABLE IF NOT EXISTS "event_aufgaben" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "event_id" text,
  "text" text,
  "frist" timestamptz,
  "erledigt" boolean,
  "art" text,
  "reihenfolge" integer
);
ALTER TABLE "event_aufgaben" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_event_aufgaben_event_id" ON "event_aufgaben" ("event_id");
CREATE INDEX IF NOT EXISTS "idx_event_aufgaben_frist" ON "event_aufgaben" ("frist");

-- Vorlagen (Modul events)
CREATE TABLE IF NOT EXISTS "event_vorlagen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "typ" text,
  "eintraege" jsonb,
  "ablauf" jsonb
);
ALTER TABLE "event_vorlagen" ENABLE ROW LEVEL SECURITY;
