// Generische Routen zum Lesen und Bearbeiten von Tabellen, die als «bearbeitbar» markiert sind.
// Die Validierung kommt aus dem Schema, die Formulare im Frontend ebenfalls.
import type { FastifyInstance } from 'fastify';
import { alleSpalten, EingabeFehler, type Tabelle, validieren } from '../daten/schema.ts';
import type { TabellenInfo } from '../geteilt/typen.ts';
import type { Hub } from './hub.ts';

export function tabellenInfo(t: Tabelle): TabellenInfo {
  return {
    name: t.name,
    label: t.label,
    modul: t.modul,
    anzeige: t.anzeige,
    spalten: t.spalten
      .filter((s) => !s.intern)
      .map((s) => ({
        name: s.name,
        typ: s.typ,
        label: s.label ?? s.name,
        pflicht: s.pflicht,
        optionen: s.optionen,
        verweis: s.verweis,
        lang: s.lang,
        einheit: s.einheit,
        min: s.min,
        max: s.max,
      })),
  };
}

export function crudRouten(app: FastifyInstance, hub: Hub) {
  const bearbeitbar = (name: string) => {
    const t = hub.daten.tabelle(name);
    if (!t?.bearbeitbar) throw new EingabeFehler('Tabelle nicht verfügbar');
    if (!hub.modulAktiv(t.modul)) throw new EingabeFehler('Modul ausgeschaltet');
    return t;
  };

  app.get('/api/schema', async () =>
    hub.daten
      .alleTabellen()
      .filter((t) => t.bearbeitbar)
      .map(tabellenInfo),
  );

  app.get<{ Params: { tabelle: string }; Querystring: Record<string, string> }>(
    '/api/daten/:tabelle',
    async (req) => {
      const t = bearbeitbar(req.params.tabelle);
      const spalten = new Set(alleSpalten(t).map((s) => s.name));
      const { sort, limit, ...rest } = req.query;
      const filter: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (spalten.has(k)) filter[k] = v;
      const sortierung = sort && spalten.has(sort.replace(/^-/, '')) ? sort : '-erstellt';
      return hub.daten.liste(t.name, { filter, sortierung, limit: Math.min(Number(limit) || 500, 2000) });
    },
  );

  app.post<{ Params: { tabelle: string }; Body: Record<string, unknown> }>(
    '/api/daten/:tabelle',
    async (req) => {
      const t = bearbeitbar(req.params.tabelle);
      const zeile = await hub.daten.eins(t.name, validieren(t, req.body, false));
      await hub.aktivitaet(t.modul, `${t.label}: Eintrag erstellt`, 'aktion');
      return zeile;
    },
  );

  app.put<{ Params: { tabelle: string; id: string }; Body: Record<string, unknown> }>(
    '/api/daten/:tabelle/:id',
    async (req, reply) => {
      const t = bearbeitbar(req.params.tabelle);
      const z = await hub.daten.aendern(t.name, req.params.id, validieren(t, req.body, true));
      if (!z) return reply.code(404).send({ fehler: 'Nicht gefunden' });
      await hub.aktivitaet(t.modul, `${t.label}: Eintrag geändert`, 'aktion');
      return z;
    },
  );

  app.delete<{ Params: { tabelle: string; id: string }; Querystring: { bestaetigt?: string } }>(
    '/api/daten/:tabelle/:id',
    async (req, reply) => {
      const t = bearbeitbar(req.params.tabelle);
      if (req.query.bestaetigt !== 'ja') return reply.code(400).send({ fehler: 'Bestätigung fehlt' });
      const ok = await hub.daten.loeschen(t.name, req.params.id);
      if (ok) await hub.aktivitaet(t.modul, `${t.label}: Eintrag gelöscht`, 'aktion');
      return { ok };
    },
  );
}
