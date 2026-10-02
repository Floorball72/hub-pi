// Modul Intelligente Abrufe: zeigt und steuert den zentralen Abrufplaner.
// Ausgeschaltet gelten die festen Gültigkeiten der Quellen (ohne Anpassung an die Nutzung).
import type { FastifyInstance } from 'fastify';
import { EingabeFehler } from '../../daten/schema.ts';
import type { Kachel } from '../../geteilt/typen.ts';
import type { Kontext, ModulDef } from '../../kern/modul.ts';
import { FAKTOR, type Modus, type PlanerEinstellung } from '../../kern/planer.ts';
import { bedingteAbrufe } from '../../quellen/http.ts';

export const abrufe: ModulDef = {
  id: 'abrufe',
  name: 'Intelligente Abrufe',
  beschreibung:
    'Zentraler Planer: wie oft jede Quelle abgerufen wird, mit Budget, Backoff und Nutzungsstufen',
  symbol: 'abrufe',
  reihenfolge: 92,
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { planer } = ctx.kern;

  function liste() {
    const gesehen = new Set<string>();
    return ctx.kern
      .quellen()
      .filter((q) => !gesehen.has(q.def.id) && gesehen.add(q.def.id))
      .map((q) => {
        const s = q.status();
        return {
          id: q.def.id,
          name: q.def.name,
          modul: q.def.modul,
          grundSek: q.def.ttlSek,
          wirksamSek: planer.ttlSek(q.def),
          minSek: planer.minSek(q.def),
          wichtig: !!q.def.wichtig,
          budgetStandard: q.def.tagesBudget ?? 0,
          einstellung: planer.einstellung(q.def.id),
          zaehler: planer.zaehlerVon(q.def.id),
          zustand: s.zustand,
        };
      })
      .sort((a, b) => a.modul.localeCompare(b.modul) || a.name.localeCompare(b.name));
  }

  async function routen(app: FastifyInstance) {
    app.get('/liste', async () => ({
      quellen: liste(),
      nutzung: planer.nutzungsStufe(),
      faktoren: FAKTOR,
      bedingt: bedingteAbrufe,
    }));
    app.put<{ Params: { id: string }; Body: { modus?: string; fixSek?: number; budget?: number } }>(
      '/quelle/:id',
      async (req) => {
        const id = req.params.id;
        if (!ctx.kern.quellen().some((q) => q.def.id === id)) throw new EingabeFehler('Quelle unbekannt');
        const modus = req.body?.modus as Modus;
        if (!['auto', 'fix', 'aus'].includes(modus)) throw new EingabeFehler('Modus auto, fix oder aus');
        const e: PlanerEinstellung = { modus };
        if (modus === 'fix') {
          const f = Number(req.body?.fixSek);
          if (!Number.isFinite(f) || f < 10 || f > 7 * 86400)
            throw new EingabeFehler('Intervall zwischen 10 Sekunden und 7 Tagen');
          e.fixSek = Math.round(f);
        }
        const b = Number(req.body?.budget ?? 0);
        if (!Number.isFinite(b) || b < 0 || b > 100000) throw new EingabeFehler('Budget ungültig');
        if (b) e.budget = Math.round(b);
        await ctx.einstellungen.setze(`abruf.${id}`, modus === 'auto' && !e.budget ? null : e);
        await ctx.aktivitaet(
          'abrufe',
          `Abruf ${id}: ${modus}${e.fixSek ? ` alle ${e.fixSek} s` : ''}${e.budget ? `, Budget ${e.budget}` : ''}`,
          'aktion',
        );
        return { ok: true };
      },
    );
  }

  async function kachel(): Promise<Kachel> {
    const l = liste();
    const heute = l.reduce((s, q) => s + q.zaehler.heute, 0);
    const pausiert = l.filter((q) => q.zaehler.gesperrtBis).length;
    const STUFE: Record<string, string> = {
      aktiv: 'aktiv genutzt',
      ruhig: 'ruhig',
      schlaf: 'keine Nutzung',
      nacht: 'Nacht',
    };
    return {
      status: pausiert ? 'warnung' : 'ok',
      titel: 'Abrufe',
      wert: String(heute),
      einheit: 'heute',
      unter: `Takt: ${STUFE[planer.nutzungsStufe()]}`,
      zeilen: [
        { text: 'Quellen', wert: String(l.length) },
        { text: 'Pausiert nach Fehlern', wert: String(pausiert), status: pausiert ? 'warnung' : 'neutral' },
        { text: '304 nicht geändert', wert: String(bedingteAbrufe.nichtGeaendert) },
      ],
      demo: ctx.konfig.demo,
    };
  }

  return { routen, kachel };
}
