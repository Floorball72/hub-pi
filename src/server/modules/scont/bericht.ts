// Monatsreport pro Kunde (PDF) und Daten der öffentlichen Statusseite.
import type { Daten } from '../../daten/index.ts';
import { Pdf } from '../../kern/pdf.ts';
import { vonLokal } from '../../kern/zeit.ts';
import type { Seite } from './tabellen.ts';

export interface MonatsDaten {
  kunde: { id: string; name: string; stundensatz: number | null };
  monat: string;
  seiten: {
    name: string;
    url: string;
    verfuegbarkeit: number | null;
    messungen: number;
    antwortMs: number | null;
    ausfaelle: { start: string; ende: string | null; grund: string | null; minuten: number | null }[];
    pagespeed: number | null;
    note: string | null;
    sicherheitNote: string | null;
    sslBis: string | null;
  }[];
  zeitMinuten: number;
  zeitEintraege: { start: string; minuten: number; beschreibung: string | null }[];
  kosten: { bezeichnung: string; betrag: number; intervall: string }[];
}

export function monatsGrenzen(monat: string): { von: Date; bis: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(monat);
  if (!m) throw new Error('Monat im Format JJJJ-MM');
  const j = Number(m[1]);
  const mo = Number(m[2]);
  return { von: vonLokal(j, mo, 1), bis: mo === 12 ? vonLokal(j + 1, 1, 1) : vonLokal(j, mo + 1, 1) };
}

/** Verfügbarkeit und Antwortzeit aus Rohdaten und verdichteten Stundenwerten (gewichtet nach Anzahl) */
export async function seitenStatistik(daten: Daten, seiteId: string, von: Date, bis: Date) {
  const roh = await daten.liste<{ ok: boolean; ms: number | null }>('pruefungen', {
    filter: { seite_id: seiteId, erstellt: { gte: von.toISOString(), lt: bis.toISOString() } },
    limit: 50000,
  });
  const stunden = await daten.liste<{ anzahl: number; ok: number | null; ms: number | null }>(
    'pruefungen_stunden',
    {
      filter: { seite_id: seiteId, zeit: { gte: von.toISOString(), lt: bis.toISOString() } },
      limit: 5000,
    },
  );
  let n = roh.length;
  let ok = roh.filter((r) => r.ok).length;
  let msSumme = roh.reduce((s, r) => s + (r.ok && r.ms ? r.ms : 0), 0);
  let msAnzahl = roh.filter((r) => r.ok && r.ms).length;
  for (const s of stunden) {
    n += s.anzahl;
    ok += (s.ok ?? 0) * s.anzahl;
    if (s.ms !== null) {
      msSumme += s.ms * s.anzahl;
      msAnzahl += s.anzahl;
    }
  }
  return {
    messungen: n,
    verfuegbarkeit: n ? Math.round((ok / n) * 10000) / 100 : null,
    antwortMs: msAnzahl ? Math.round(msSumme / msAnzahl) : null,
  };
}

export async function monatsDaten(daten: Daten, kundeId: string, monat: string): Promise<MonatsDaten> {
  const kunde = await daten.hole<{ id: string; name: string; stundensatz: number | null }>('kunden', kundeId);
  if (!kunde) throw new Error('Kunde nicht gefunden');
  const { von, bis } = monatsGrenzen(monat);
  const seiten = await daten.liste<Seite>('seiten', {
    filter: { kunde_id: kundeId },
    sortierung: 'name',
    limit: 50,
  });
  const aus: MonatsDaten['seiten'] = [];
  for (const s of seiten) {
    const st = await seitenStatistik(daten, s.id, von, bis);
    const vorfaelle = await daten.liste<{ start: string; ende: string | null; grund: string | null }>(
      'vorfaelle',
      {
        filter: { seite_id: s.id, start: { gte: von.toISOString(), lt: bis.toISOString() } },
        sortierung: 'start',
        limit: 200,
      },
    );
    const ps = await daten.liste<{ performance: number | null }>('pagespeed', {
      filter: { seite_id: s.id, erstellt: { gte: von.toISOString(), lt: bis.toISOString() } },
      limit: 100,
    });
    const psWerte = ps.map((p) => p.performance).filter((p): p is number => p !== null);
    const [q] = await daten.liste<{ note: string }>('qualitaet', {
      filter: { seite_id: s.id, erstellt: { lt: bis.toISOString() } },
      sortierung: '-erstellt',
      limit: 1,
    });
    let sicherheit: { note: string } | undefined;
    if (daten.tabelle('sicherheit_checks')) {
      [sicherheit] = await daten.liste<{ note: string }>('sicherheit_checks', {
        filter: { seite_id: s.id, erstellt: { lt: bis.toISOString() } },
        sortierung: '-erstellt',
        limit: 1,
      });
    }
    const [ssl] = await daten.liste<{ gueltig_bis: string | null }>('ssl_status', {
      filter: { seite_id: s.id },
      limit: 1,
    });
    aus.push({
      name: s.name,
      url: s.url,
      ...st,
      ausfaelle: vorfaelle.map((v) => ({
        ...v,
        minuten: v.ende
          ? Math.round((new Date(v.ende).getTime() - new Date(v.start).getTime()) / 60000)
          : null,
      })),
      pagespeed: psWerte.length ? Math.round(psWerte.reduce((a, b) => a + b, 0) / psWerte.length) : null,
      note: q?.note ?? null,
      sicherheitNote: sicherheit?.note ?? null,
      sslBis: ssl?.gueltig_bis ?? null,
    });
  }
  const zeiten = await daten.liste<{
    start: string;
    ende: string | null;
    minuten: number | null;
    beschreibung: string | null;
  }>('zeiten', {
    filter: { kunde_id: kundeId, start: { gte: von.toISOString(), lt: bis.toISOString() } },
    sortierung: 'start',
    limit: 2000,
  });
  const kosten = await daten.liste<{
    bezeichnung: string;
    betrag: number;
    intervall: string;
    weiterverrechnet: boolean;
  }>('kosten', {
    filter: { kunde_id: kundeId },
    limit: 200,
  });
  return {
    kunde,
    monat,
    seiten: aus,
    zeitMinuten: zeiten.reduce((s, z) => s + (z.minuten ?? 0), 0),
    zeitEintraege: zeiten
      .filter((z) => z.minuten)
      .map((z) => ({ start: z.start, minuten: z.minuten!, beschreibung: z.beschreibung })),
    kosten: kosten
      .filter((k) => k.weiterverrechnet)
      .map((k) => ({ bezeichnung: k.bezeichnung, betrag: k.betrag, intervall: k.intervall })),
  };
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const datum = (iso: string) =>
  new Date(iso).toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function monatsreportPdf(d: MonatsDaten, jetzt = new Date()): Buffer {
  const pdf = new Pdf();
  const [j, m] = d.monat.split('-').map(Number);
  const RAND = 50;
  const AKZENT: [number, number, number] = [0.1, 0.55, 0.72];
  const GRAU: [number, number, number] = [0.42, 0.46, 0.52];
  let y = 60;
  const platz = (benoetigt: number) => {
    if (y + benoetigt > pdf.hoehe - 60) {
      pdf.neueSeite();
      y = 60;
    }
  };
  pdf.rechteck(0, 0, pdf.breite, 8, AKZENT);
  pdf.text(RAND, y, 'Monatsreport', { groesse: 11, farbe: AKZENT, fett: true });
  y += 28;
  pdf.text(RAND, y, d.kunde.name, { groesse: 22, fett: true });
  y += 22;
  pdf.text(RAND, y, `${MONATE[m - 1]} ${j}`, { groesse: 13, farbe: GRAU });
  y += 30;

  for (const s of d.seiten) {
    platz(150);
    pdf.text(RAND, y, s.name, { groesse: 14, fett: true });
    pdf.text(pdf.breite - RAND, y, s.url.replace(/^https?:\/\//, ''), {
      groesse: 9,
      farbe: GRAU,
      rechts: true,
    });
    y += 8;
    pdf.linie(RAND, y, pdf.breite - RAND, y);
    y += 26;
    const kennzahlen: [string, string][] = [
      [
        'Verfügbarkeit',
        s.verfuegbarkeit === null ? 'keine Daten' : `${s.verfuegbarkeit.toLocaleString('de-CH')} %`,
      ],
      ['Antwortzeit (Mittel)', s.antwortMs === null ? '-' : `${s.antwortMs} ms`],
      ['Ausfälle', String(s.ausfaelle.length)],
      ['PageSpeed (mobil)', s.pagespeed === null ? '-' : String(s.pagespeed)],
    ];
    const spalte = (pdf.breite - 2 * RAND) / kennzahlen.length;
    kennzahlen.forEach(([titel, wert], i) => {
      pdf.text(RAND + i * spalte, y, wert, { groesse: 16, fett: true });
      pdf.text(RAND + i * spalte, y + 14, titel, { groesse: 8, farbe: GRAU });
    });
    y += 36;
    const zusatz = [
      s.note ? `Qualitätscheck: Note ${s.note}` : null,
      s.sicherheitNote ? `Sicherheit: Note ${s.sicherheitNote}` : null,
      s.sslBis ? `SSL Zertifikat gültig bis ${datum(s.sslBis).slice(0, 10)}` : null,
      `${s.messungen.toLocaleString('de-CH')} Messungen`,
    ].filter(Boolean);
    pdf.text(RAND, y, zusatz.join('   ·   '), { groesse: 9, farbe: GRAU });
    y += 18;
    if (s.ausfaelle.length) {
      pdf.text(RAND, y, 'Ausfälle', { groesse: 10, fett: true });
      y += 15;
      for (const a of s.ausfaelle.slice(0, 15)) {
        platz(14);
        pdf.text(RAND + 8, y, datum(a.start), { groesse: 9 });
        pdf.text(RAND + 120, y, a.minuten === null ? 'dauert an' : `${a.minuten} min`, { groesse: 9 });
        pdf.text(RAND + 200, y, (a.grund ?? '').slice(0, 60), { groesse: 9, farbe: GRAU });
        y += 13;
      }
    }
    y += 20;
  }
  if (!d.seiten.length) {
    pdf.text(RAND, y, 'Für diesen Kunden sind keine überwachten Seiten erfasst.', {
      groesse: 10,
      farbe: GRAU,
    });
    y += 24;
  }

  platz(80);
  pdf.text(RAND, y, 'Aufwand', { groesse: 14, fett: true });
  y += 8;
  pdf.linie(RAND, y, pdf.breite - RAND, y);
  y += 22;
  const stunden = Math.round((d.zeitMinuten / 60) * 100) / 100;
  pdf.text(RAND, y, `${stunden.toLocaleString('de-CH')} Stunden`, { groesse: 16, fett: true });
  if (d.kunde.stundensatz) {
    pdf.text(
      pdf.breite - RAND,
      y,
      `CHF ${(stunden * d.kunde.stundensatz).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      {
        groesse: 16,
        fett: true,
        rechts: true,
      },
    );
  }
  y += 20;
  for (const z of d.zeitEintraege.slice(0, 40)) {
    platz(14);
    pdf.text(RAND + 8, y, datum(z.start).slice(0, 10), { groesse: 9 });
    pdf.text(RAND + 90, y, `${Math.round(z.minuten)} min`, { groesse: 9 });
    pdf.text(RAND + 150, y, (z.beschreibung ?? '').slice(0, 70), { groesse: 9, farbe: GRAU });
    y += 13;
  }
  if (d.kosten.length) {
    y += 12;
    platz(40 + d.kosten.length * 13);
    pdf.text(RAND, y, 'Weiterverrechnete Leistungen', { groesse: 10, fett: true });
    y += 15;
    for (const k of d.kosten) {
      pdf.text(RAND + 8, y, k.bezeichnung, { groesse: 9 });
      pdf.text(pdf.breite - RAND, y, `CHF ${k.betrag.toFixed(2)} (${k.intervall})`, {
        groesse: 9,
        rechts: true,
      });
      y += 13;
    }
  }
  pdf.text(RAND, pdf.hoehe - 30, `Erstellt am ${datum(jetzt.toISOString())} mit Pi Hub`, {
    groesse: 8,
    farbe: GRAU,
  });
  return pdf.erstellen(`Monatsreport ${d.kunde.name} ${d.monat}`);
}

// Öffentliche Statusseite: nur Namen und Verfügbarkeit, keine Adressen und keine Fehlermeldungen

export interface OeffentlicherStatus {
  name: string;
  online: boolean | null;
  tage: (number | null)[];
  verfuegbarkeit30: number | null;
}

export function statusHtml(liste: OeffentlicherStatus[], stand: Date): string {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const alleOk = liste.every((s) => s.online !== false);
  const zeilen = liste
    .map((s) => {
      const balken = s.tage
        .map((t) => {
          const klasse = t === null ? 'leer' : t >= 99.5 ? 'gut' : t >= 95 ? 'mittel' : 'schlecht';
          return `<i class="${klasse}" title="${t === null ? 'keine Daten' : `${t.toFixed(2)} %`}"></i>`;
        })
        .join('');
      return `<section><div class="kopf"><h2>${esc(s.name)}</h2><span class="${s.online === false ? 'stoerung' : 'ok'}">${s.online === false ? 'Störung' : 'In Betrieb'}</span></div><div class="balken">${balken}</div><div class="fuss"><span>vor 30 Tagen</span><span>${s.verfuegbarkeit30 === null ? '' : `${s.verfuegbarkeit30.toFixed(2)} % Verfügbarkeit`}</span><span>heute</span></div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Status</title><style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1b1f24}
main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:1.5rem;margin:0 0 6px}
.gesamt{padding:16px 18px;border-radius:12px;margin:18px 0 24px;font-weight:600;color:#fff;background:${alleOk ? '#1f9d63' : '#d64545'}}
section{background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:16px 18px;margin-bottom:12px}
.kopf{display:flex;justify-content:space-between;align-items:center;gap:8px}
h2{font-size:1rem;margin:0}
.ok{color:#1f9d63;font-weight:600;font-size:.9rem}.stoerung{color:#d64545;font-weight:600;font-size:.9rem}
.balken{display:flex;gap:2px;margin:12px 0 6px;height:30px}
.balken i{flex:1;border-radius:2px}.gut{background:#2fb875}.mittel{background:#f0b429}.schlecht{background:#e05252}.leer{background:#e3e6ea}
.fuss{display:flex;justify-content:space-between;font-size:.75rem;color:#6b7480}
footer{font-size:.75rem;color:#6b7480;margin-top:24px}
</style></head><body><main><h1>Status</h1><div class="gesamt">${alleOk ? 'Alle Systeme in Betrieb' : 'Es gibt eine Störung'}</div>${zeilen || '<p>Keine Einträge.</p>'}<footer>Stand ${esc(stand.toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</footer></main></body></html>`;
}
