// Modul Auffälligkeiten: lernt für jede gemeldete Metrik den Normalbereich (Median und MAD je Werktag/Wochenende
// und Stunde, nachts neu berechnet) und meldet anhaltende Abweichungen über die Alarmzentrale.
import type { FastifyInstance } from 'fastify';
import { EingabeFehler, tabelle } from '../../daten/schema.ts';
import { verdichten } from '../../daten/verdichtung.ts';
import type { Ampel, Kachel } from '../../geteilt/typen.ts';
import {
  type Basis,
  bewerten,
  type Empfindlichkeit,
  eimer,
  faktorNachRueckmeldung,
  type MetrikDef,
  medianMad,
  SCHWELLE,
} from '../../kern/metriken.ts';
import type { JobDef, Kontext, ModulDef } from '../../kern/modul.ts';

export const BASIS = tabelle({
  name: 'metrik_basis',
  modul: 'auffaelligkeiten',
  label: 'Normalbereiche',
  spalten: [
    { name: 'metrik', typ: 'text' },
    { name: 'eimer', typ: 'text' },
    { name: 'median', typ: 'real' },
    { name: 'mad', typ: 'real' },
    { name: 'n', typ: 'int' },
    { name: 'erster', typ: 'zeit' },
  ],
  indizes: [['metrik']],
});

export const EREIGNISSE = tabelle({
  name: 'metrik_ereignisse',
  modul: 'auffaelligkeiten',
  label: 'Auffälligkeiten',
  spalten: [
    { name: 'metrik', typ: 'text' },
    { name: 'start', typ: 'zeit' },
    { name: 'ende', typ: 'zeit' },
    { name: 'wert', typ: 'real' },
    { name: 'median', typ: 'real' },
    { name: 'z', typ: 'real' },
    { name: 'richtung', typ: 'text' },
    { name: 'rueckmeldung', typ: 'text' },
  ],
  indizes: [['metrik', 'start']],
});

export const LERNTAGE = 14;
const GESCHICHTE_TAGE = 28;

interface Ereignis {
  id: string;
  metrik: string;
  start: string;
  ende: string | null;
  wert: number;
  median: number;
  z: number;
  richtung: 'hoch' | 'tief';
  rueckmeldung: 'normal' | 'relevant' | null;
}
interface MetrikEinstellung {
  empfindlichkeit?: Empfindlichkeit;
  faktor?: number;
}

/** Stundenmittel aus Rohwerten */
export function stundenMittel(werte: { zeit: string; wert: number }[]): { zeit: string; wert: number }[] {
  const g = new Map<string, number[]>();
  for (const w of werte) {
    const d = new Date(w.zeit);
    d.setUTCMinutes(0, 0, 0);
    const k = d.toISOString();
    const l = g.get(k) ?? [];
    l.push(w.wert);
    g.set(k, l);
  }
  return [...g.entries()]
    .map(([zeit, l]) => ({ zeit, wert: l.reduce((a, b) => a + b, 0) / l.length }))
    .sort((a, b) => a.zeit.localeCompare(b.zeit));
}

/** Normalbereiche je Eimer und als Rückfall je Stunde und gesamt */
export function basisBerechnen(stunden: { zeit: string; wert: number }[]): Map<string, Basis> {
  const g = new Map<string, number[]>();
  const add = (k: string, w: number) => {
    const l = g.get(k) ?? [];
    l.push(w);
    g.set(k, l);
  };
  for (const s of stunden) {
    const e = eimer(new Date(s.zeit));
    add(e, s.wert);
    add(`alle-${e.split('-')[1]}`, s.wert);
    add('alle', s.wert);
  }
  const aus = new Map<string, Basis>();
  for (const [k, l] of g) if (l.length >= 3) aus.set(k, { ...medianMad(l), n: l.length });
  return aus;
}

export function basisFuer(b: Map<string, Basis>, d: Date): Basis | null {
  const e = eimer(d);
  for (const k of [e, `alle-${e.split('-')[1]}`, 'alle']) {
    const x = b.get(k);
    if (x && x.n >= (k === 'alle' ? 24 : 4)) return x;
  }
  return null;
}

export const auffaelligkeiten: ModulDef = {
  id: 'auffaelligkeiten',
  name: 'Auffälligkeiten',
  beschreibung: 'Lernt Normalbereiche aller Messwerte und meldet ungewöhnliche Abweichungen',
  symbol: 'auffaelligkeiten',
  reihenfolge: 90,
  tabellen: [BASIS, EREIGNISSE],
  regeln: [
    {
      id: 'abweichung',
      name: 'Ungewöhnlicher Messwert',
      beschreibung: 'Ein Messwert liegt anhaltend ausserhalb seines gelernten Normalbereichs.',
      prioritaet: 3,
      cooldownMin: 180,
    },
    {
      id: 'kritisch',
      name: 'Ungewöhnlicher Messwert (hohe Priorität)',
      beschreibung:
        'Wie oben, für wichtige Metriken (z.B. Antwortzeit von Kundenseiten). Darf auch nachts melden.',
      prioritaet: 4,
      cooldownMin: 180,
      nachts: true,
    },
  ],
  erstellen: (ctx) => laufzeit(ctx),
};

function laufzeit(ctx: Kontext) {
  const { daten, konfig } = ctx;
  const reg = ctx.kern.metriken;
  const basen = new Map<string, Map<string, Basis>>();
  const ersterWert = new Map<string, number>();
  const zustand = new Map<string, { seit: number }>();
  let geladen: Promise<void> | null = null;

  const empfindlichkeit = () =>
    ctx.einstellungen.hole<Empfindlichkeit>('auffaelligkeiten.empfindlichkeit', 'normal');
  const metrikEinstellung = (id: string) =>
    ctx.einstellungen.hole<MetrikEinstellung>(`auffaelligkeiten.m.${id}`, {});
  function schwelleFuer(id: string): number | null {
    const e = metrikEinstellung(id);
    const stufe = e.empfindlichkeit ?? empfindlichkeit();
    if (stufe === 'aus') return null;
    return SCHWELLE[stufe] * (e.faktor ?? 1);
  }

  async function geschichte(id: string, tage: number) {
    const ab = new Date(ctx.jetzt().getTime() - tage * 86400000).toISOString();
    const st = await daten.liste<{ zeit: string; wert: number }>('metrik_stunden', {
      filter: { metrik: id, zeit: { gte: ab } },
      sortierung: 'zeit',
      limit: 20000,
    });
    const roh = await daten.liste<{ erstellt: string; wert: number }>('metrik_werte', {
      filter: { metrik: id, erstellt: { gte: ab } },
      sortierung: 'erstellt',
      limit: 50000,
    });
    return [...st, ...stundenMittel(roh.map((r) => ({ zeit: r.erstellt, wert: r.wert })))];
  }

  async function basisNeu(): Promise<string> {
    const ids = new Set<string>([...reg.defs.keys()]);
    for (const z of await daten.liste<{ metrik: string }>('metrik_basis', { limit: 5000 })) ids.add(z.metrik);
    let n = 0;
    for (const id of ids) {
      const g = await geschichte(id, GESCHICHTE_TAGE);
      const [aeltester] = await daten.liste<{ zeit: string }>('metrik_stunden', {
        filter: { metrik: id },
        sortierung: 'zeit',
        limit: 1,
      });
      const [aeltesterRoh] = await daten.liste<{ erstellt: string }>('metrik_werte', {
        filter: { metrik: id },
        sortierung: 'erstellt',
        limit: 1,
      });
      const erster = Math.min(
        aeltester ? Date.parse(aeltester.zeit) : Number.POSITIVE_INFINITY,
        aeltesterRoh ? Date.parse(aeltesterRoh.erstellt) : Number.POSITIVE_INFINITY,
      );
      const b = basisBerechnen(g);
      await daten.loescheWo('metrik_basis', { metrik: id });
      if (!b.size) continue;
      await daten.einfuegen(
        'metrik_basis',
        [...b.entries()].map(([k, x]) => ({
          metrik: id,
          eimer: k,
          median: x.median,
          mad: x.mad,
          n: x.n,
          erster: Number.isFinite(erster) ? new Date(erster).toISOString() : null,
        })),
      );
      basen.set(id, b);
      if (Number.isFinite(erster)) ersterWert.set(id, erster);
      n++;
    }
    return `${n} Normalbereiche berechnet`;
  }

  async function laden() {
    geladen ??= (async () => {
      if (konfig.demo) await demoVorbereiten();
      for (const z of await daten.liste<{
        metrik: string;
        eimer: string;
        median: number;
        mad: number;
        n: number;
        erster: string | null;
      }>('metrik_basis', { limit: 20000 })) {
        const m = basen.get(z.metrik) ?? new Map<string, Basis>();
        m.set(z.eimer, { median: z.median, mad: z.mad, n: z.n });
        basen.set(z.metrik, m);
        if (z.erster) ersterWert.set(z.metrik, Date.parse(z.erster));
      }
    })();
    await geladen;
  }

  function lernTageOffen(id: string): number {
    const e = ersterWert.get(id);
    if (!e) return LERNTAGE;
    return Math.max(0, Math.ceil(LERNTAGE - (ctx.jetzt().getTime() - e) / 86400000));
  }

  async function pruefen(): Promise<string | undefined> {
    await laden();
    const jetzt = ctx.jetzt();
    let gemeldet = 0;
    for (const [id, def] of reg.defs) {
      const l = reg.letzte.get(id);
      const schwelle = schwelleFuer(id);
      const b = basen.get(id);
      const [offen] = await daten.liste<Ereignis>('metrik_ereignisse', {
        filter: { metrik: id, ende: { istNull: true } },
        limit: 1,
      });
      if (!l || jetzt.getTime() - l.zeit > 30 * 60000 || schwelle === null || !b || lernTageOffen(id) > 0) {
        zustand.delete(id);
        continue;
      }
      const basis = basisFuer(b, jetzt);
      if (!basis) continue;
      const r = bewerten(l.wert, basis, def, schwelle);
      if (!r.ausserhalb) {
        zustand.delete(id);
        if (offen) await daten.aendern('metrik_ereignisse', offen.id, { ende: jetzt.toISOString() });
        continue;
      }
      const s = zustand.get(id) ?? { seit: l.zeit };
      zustand.set(id, s);
      if (offen) {
        if (Math.abs(r.z) > Math.abs(offen.z))
          await daten.aendern('metrik_ereignisse', offen.id, { wert: l.wert, z: Math.round(r.z * 10) / 10 });
        continue;
      }
      if (jetzt.getTime() - s.seit < (def.minDauerMin ?? 15) * 60000) continue;
      const [letztes] = await daten.liste<Ereignis>('metrik_ereignisse', {
        filter: { metrik: id },
        sortierung: '-start',
        limit: 1,
      });
      if (letztes?.ende && jetzt.getTime() - Date.parse(letztes.ende) < (def.cooldownMin ?? 360) * 60000)
        continue;
      await daten.einfuegen('metrik_ereignisse', [
        {
          metrik: id,
          start: new Date(s.seit).toISOString(),
          wert: l.wert,
          median: basis.median,
          z: Math.round(r.z * 10) / 10,
          richtung: r.richtung,
        },
      ]);
      gemeldet++;
      const f = (x: number) => `${Math.round(x * 10) / 10}${def.einheit ? ` ${def.einheit}` : ''}`;
      await ctx.alarm.melden({
        regel: (def.prioritaet ?? 3) >= 4 ? 'auffaelligkeiten.kritisch' : 'auffaelligkeiten.abweichung',
        titel: `${def.name} ungewöhnlich ${r.richtung === 'hoch' ? 'hoch' : 'tief'}`,
        text: `Aktuell ${f(l.wert)}, üblich um diese Zeit ${f(basis.median)}. Seit ${Math.round((jetzt.getTime() - s.seit) / 60000)} Minuten.`,
        schluessel: `auff:${id}:${r.richtung}`,
        link: '/modul/auffaelligkeiten',
      });
    }
    return gemeldet ? `${gemeldet} Auffälligkeiten` : undefined;
  }

  /** Demo: vier Wochen synthetischer Verlauf je Metrik mit Tagesgang, damit Normalbereiche sichtbar sind */
  async function demoVorbereiten() {
    if ((await daten.anzahl('metrik_basis')) > 0) return;
    const demoMetriken: (MetrikDef & { typisch: number; gang: number })[] = [
      { id: 'zentrale.ram', name: 'RAM des Hubs', einheit: 'MB', modul: 'zentrale', typisch: 95, gang: 0.04 },
      {
        id: 'zentrale.temperatur',
        name: 'CPU Temperatur',
        einheit: '°C',
        modul: 'zentrale',
        typisch: 52,
        gang: 0.08,
      },
      {
        id: 'parken.frei',
        name: 'Freie Parkplätze St. Gallen',
        einheit: 'Plätze',
        modul: 'parken',
        typisch: 900,
        gang: 0.45,
      },
      {
        id: 'rettung.helis',
        name: 'Helikopter in der Luft',
        einheit: '',
        modul: 'rettung',
        typisch: 1,
        gang: 0.6,
      },
    ];
    const jetzt = ctx.jetzt().getTime();
    const stunden: { zeit: string; metrik: string; anzahl: number; wert: number }[] = [];
    for (const m of demoMetriken) {
      if (!reg.defs.has(m.id)) reg.registrieren(m);
      for (let t = jetzt - GESCHICHTE_TAGE * 86400000; t < jetzt; t += 3600000) {
        const d = new Date(t);
        d.setUTCMinutes(0, 0, 0);
        const h = (d.getUTCHours() + 2) % 24;
        const tag = Math.sin(((h - 7) / 24) * 2 * Math.PI);
        const rausch = Math.sin(t / 3.7e6) * 0.03 + Math.cos(t / 9.1e6) * 0.02;
        let w = m.typisch * (1 + m.gang * (m.id === 'parken.frei' ? -tag : tag) + rausch);
        if (m.id === 'rettung.helis') w = Math.max(0, Math.round(w));
        stunden.push({ zeit: d.toISOString(), metrik: m.id, anzahl: 6, wert: Math.round(w * 10) / 10 });
      }
      // aktueller Wert: bei der Temperatur deutlich über dem Normalbereich
      reg.letzte.set(m.id, {
        wert: m.id === 'zentrale.temperatur' ? 76 : stunden[stunden.length - 1].wert,
        zeit: jetzt,
      });
    }
    await daten.einfuegen('metrik_stunden', stunden);
    await basisNeu();
    await daten.einfuegen('metrik_ereignisse', [
      {
        metrik: 'zentrale.temperatur',
        start: new Date(jetzt - 40 * 60000).toISOString(),
        wert: 76,
        median: 56,
        z: 6.4,
        richtung: 'hoch',
      },
      {
        metrik: 'parken.frei',
        start: new Date(jetzt - 3 * 86400000).toISOString(),
        ende: new Date(jetzt - 3 * 86400000 + 2 * 3600000).toISOString(),
        wert: 210,
        median: 780,
        z: -5.2,
        richtung: 'tief',
        rueckmeldung: 'normal',
      },
    ]);
  }

  async function uebersicht() {
    await laden();
    const jetzt = ctx.jetzt();
    const ids = new Set<string>([...reg.defs.keys(), ...basen.keys()]);
    const aus = [];
    for (const id of ids) {
      const def = reg.defs.get(id) ?? { id, name: id };
      const b = basen.get(id);
      const basis = b ? basisFuer(b, jetzt) : null;
      const schwelle = schwelleFuer(id);
      const streuung = basis
        ? Math.max(1.4826 * basis.mad, Math.abs(basis.median) * 0.02, (def.minAbweichung ?? 0) / 3)
        : null;
      const verlauf = (await geschichte(id, 2)).slice(-48);
      const ereignisse = await daten.liste<Ereignis>('metrik_ereignisse', {
        filter: { metrik: id },
        sortierung: '-start',
        limit: 5,
      });
      // Normalbereich je Stunde der letzten 48 h für das Band im Diagramm
      const band = b
        ? verlauf.map((v) => {
            const x = basisFuer(b, new Date(v.zeit));
            if (!x || schwelle === null) return null;
            const s = Math.max(1.4826 * x.mad, Math.abs(x.median) * 0.02, (def.minAbweichung ?? 0) / 3);
            return { min: x.median - schwelle * s, max: x.median + schwelle * s };
          })
        : [];
      aus.push({
        id,
        name: def.name,
        einheit: def.einheit ?? '',
        modul: def.modul ?? id.split('.')[0],
        letzter: reg.letzte.get(id) ?? null,
        basis,
        streuung,
        schwelle,
        lernTageOffen: lernTageOffen(id),
        einstellung: metrikEinstellung(id),
        verlauf,
        band,
        ereignisse,
      });
    }
    return aus.sort((a, b) => a.modul.localeCompare(b.modul) || a.name.localeCompare(b.name));
  }

  async function routen(app: FastifyInstance) {
    app.get('/uebersicht', async () => ({
      metriken: await uebersicht(),
      empfindlichkeit: empfindlichkeit(),
      lerntage: LERNTAGE,
    }));
    app.put<{ Body: { empfindlichkeit?: string } }>('/empfindlichkeit', async (req) => {
      const e = req.body?.empfindlichkeit as Empfindlichkeit;
      if (!['aus', 'niedrig', 'normal', 'hoch'].includes(e))
        throw new EingabeFehler('Empfindlichkeit ungültig');
      await ctx.einstellungen.setze('auffaelligkeiten.empfindlichkeit', e);
      return { ok: true };
    });
    app.put<{ Params: { id: string }; Body: { empfindlichkeit?: string | null } }>(
      '/metrik/:id',
      async (req) => {
        const e = req.body?.empfindlichkeit;
        if (e !== null && e !== undefined && !['aus', 'niedrig', 'normal', 'hoch'].includes(e))
          throw new EingabeFehler('Empfindlichkeit ungültig');
        if (!/^[a-z0-9_.:-]{3,120}$/i.test(req.params.id)) throw new EingabeFehler('Metrik ungültig');
        const alt = metrikEinstellung(req.params.id);
        await ctx.einstellungen.setze(`auffaelligkeiten.m.${req.params.id}`, {
          ...alt,
          empfindlichkeit: e ?? undefined,
        });
        return { ok: true };
      },
    );
    app.post<{ Params: { id: string }; Body: { rueckmeldung?: string } }>(
      '/ereignis/:id/rueckmeldung',
      async (req) => {
        const r = req.body?.rueckmeldung;
        if (r !== 'normal' && r !== 'relevant') throw new EingabeFehler('Rückmeldung normal oder relevant');
        const e = await daten.hole<Ereignis>('metrik_ereignisse', req.params.id);
        if (!e) throw new EingabeFehler('Ereignis nicht gefunden');
        await daten.aendern('metrik_ereignisse', e.id, { rueckmeldung: r });
        const alt = metrikEinstellung(e.metrik);
        const faktor = faktorNachRueckmeldung(alt.faktor ?? 1, r);
        await ctx.einstellungen.setze(`auffaelligkeiten.m.${e.metrik}`, { ...alt, faktor });
        return { faktor };
      },
    );
    app.post('/neu-berechnen', async () => ({ ergebnis: await basisNeu() }));
  }

  const jobs: JobDef[] = [
    {
      id: 'pruefen',
      name: 'Abweichungen prüfen',
      intervallSek: 300,
      startVerzoegerungSek: 120,
      lauf: pruefen,
    },
    {
      id: 'basis',
      name: 'Normalbereiche neu berechnen',
      taeglich: '03:20',
      lauf: async () => {
        await reg.leeren();
        const v = await verdichten(
          daten,
          {
            quelle: 'metrik_werte',
            ziel: 'metrik_stunden',
            nachTagen: 14,
            intervall: 'stunde',
            gruppe: ['metrik'],
            felder: [{ ziel: 'wert', art: 'mittel', feld: 'wert' }],
          },
          ctx.jetzt(),
        );
        await daten.loescheWo('metrik_stunden', {
          zeit: { lt: new Date(ctx.jetzt().getTime() - 120 * 86400000).toISOString() },
        });
        await daten.loescheWo('metrik_ereignisse', {
          start: { lt: new Date(ctx.jetzt().getTime() - 365 * 86400000).toISOString() },
        });
        return `${await basisNeu()}, ${v} Rohwerte verdichtet`;
      },
    },
  ];

  async function kachel(): Promise<Kachel> {
    const l = await uebersicht();
    const offen = l.filter((m) => m.ereignisse.some((e) => !e.ende));
    const lernen = l.filter((m) => m.lernTageOffen > 0).length;
    return {
      status: (offen.length ? 'warnung' : 'ok') as Ampel,
      titel: 'Auffälligkeiten',
      wert: String(offen.length),
      einheit: 'aktuell',
      unter: `${l.length} Messwerte${lernen ? `, ${lernen} lernen noch` : ''}`,
      zeilen: offen.slice(0, 3).map((m) => ({
        text: m.name,
        wert: m.letzter ? `${Math.round(m.letzter.wert * 10) / 10} ${m.einheit}` : '',
        status: 'warnung' as Ampel,
      })),
      demo: konfig.demo,
    };
  }

  return { routen, jobs, kachel };
}
