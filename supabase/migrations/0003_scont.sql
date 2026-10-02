-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Kunden (Modul scont)
CREATE TABLE IF NOT EXISTS "kunden" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "status" text,
  "stundensatz" double precision,
  "notizen" text
);
ALTER TABLE "kunden" ENABLE ROW LEVEL SECURITY;

-- Domains (Modul scont)
CREATE TABLE IF NOT EXISTS "domains" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "kunde_id" text,
  "registrar" text,
  "ablauf" date,
  "kosten_jahr" double precision,
  "eigene" boolean,
  "notizen" text
);
ALTER TABLE "domains" ENABLE ROW LEVEL SECURITY;

-- Kosten und Abos (Modul scont)
CREATE TABLE IF NOT EXISTS "kosten" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "bezeichnung" text,
  "art" text,
  "anbieter" text,
  "kunde_id" text,
  "betrag" double precision,
  "intervall" text,
  "naechste_zahlung" date,
  "weiterverrechnet" boolean,
  "notizen" text
);
ALTER TABLE "kosten" ENABLE ROW LEVEL SECURITY;

-- Überwachte Seiten (Modul scont)
CREATE TABLE IF NOT EXISTS "seiten" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "name" text,
  "url" text,
  "kunde_id" text,
  "aktiv" boolean,
  "intervall_min" integer,
  "erwarteter_text" text,
  "oeffentlich" boolean,
  "oeffentlicher_name" text
);
ALTER TABLE "seiten" ENABLE ROW LEVEL SECURITY;

-- Prüfungen (Rohdaten) (Modul scont)
CREATE TABLE IF NOT EXISTS "pruefungen" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "ok" boolean,
  "status" integer,
  "ms" integer,
  "fehler" text
);
ALTER TABLE "pruefungen" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_pruefungen_seite_id_erstellt" ON "pruefungen" ("seite_id", "erstellt");
CREATE INDEX IF NOT EXISTS "idx_pruefungen_erstellt" ON "pruefungen" ("erstellt");

-- Prüfungen pro Stunde (Modul scont)
CREATE TABLE IF NOT EXISTS "pruefungen_stunden" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "zeit" timestamptz,
  "seite_id" text,
  "anzahl" integer,
  "ok" double precision,
  "ms" double precision,
  "ms_max" double precision
);
ALTER TABLE "pruefungen_stunden" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_pruefungen_stunden_seite_id_zeit" ON "pruefungen_stunden" ("seite_id", "zeit");

-- Ausfälle (Modul scont)
CREATE TABLE IF NOT EXISTS "vorfaelle" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "start" timestamptz,
  "ende" timestamptz,
  "grund" text
);
ALTER TABLE "vorfaelle" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_vorfaelle_seite_id_start" ON "vorfaelle" ("seite_id", "start");

-- SSL Zertifikate (Modul scont)
CREATE TABLE IF NOT EXISTS "ssl_status" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "gueltig_bis" timestamptz,
  "aussteller" text,
  "fehler" text
);
ALTER TABLE "ssl_status" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_ssl_status_seite_id" ON "ssl_status" ("seite_id");

-- PageSpeed (Modul scont)
CREATE TABLE IF NOT EXISTS "pagespeed" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "strategie" text,
  "performance" integer,
  "barrierefreiheit" integer,
  "best_practices" integer,
  "seo" integer,
  "lcp_ms" integer,
  "cls" double precision,
  "tbt_ms" integer
);
ALTER TABLE "pagespeed" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_pagespeed_seite_id_erstellt" ON "pagespeed" ("seite_id", "erstellt");

-- Qualitätscheck (Modul scont)
CREATE TABLE IF NOT EXISTS "qualitaet" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "punkte" integer,
  "note" text,
  "ergebnis" jsonb
);
ALTER TABLE "qualitaet" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_qualitaet_seite_id_erstellt" ON "qualitaet" ("seite_id", "erstellt");
