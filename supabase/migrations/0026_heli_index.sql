-- Von Hand: Index für die Heli Detailseite (Flüge eines Transponders). Neue Indizes erkennt db:generieren nicht.

CREATE INDEX IF NOT EXISTS "idx_heli_fluege_hex_start" ON "heli_fluege" ("hex", "start");
