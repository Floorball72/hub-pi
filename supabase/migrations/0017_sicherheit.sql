-- Automatisch erzeugt mit npm run db:generieren. Nicht von Hand ändern, neue Migration erstellen.

-- Sicherheits Checks (Modul sicherheit)
CREATE TABLE IF NOT EXISTS "sicherheit_checks" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "seite_id" text,
  "domain" text,
  "note" text,
  "punkte" integer,
  "ergebnis" jsonb
);
ALTER TABLE "sicherheit_checks" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_sicherheit_checks_seite_id_erstellt" ON "sicherheit_checks" ("seite_id", "erstellt");

-- Datenlecks (Have I Been Pwned) (Modul sicherheit)
CREATE TABLE IF NOT EXISTS "sicherheit_lecks" (
  "id" text PRIMARY KEY,
  "erstellt" timestamptz NOT NULL DEFAULT now(),
  "domain" text,
  "adressen" integer,
  "lecks" jsonb
);
ALTER TABLE "sicherheit_lecks" ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS "idx_sicherheit_lecks_domain_erstellt" ON "sicherheit_lecks" ("domain", "erstellt");
