// Spielbericht aus einer Live Erfassung: Torfolge, Schlüsselmomente, beste Spieler und Zahlen.
// Reine Funktionen ohne Datenzugriff, damit testbar.
import { Pdf } from '../../kern/pdf.ts';
import { type Ereignis, nachSpieler, type Spieler, type Strafe, spezialteams, werte } from './auswertung.ts';

export interface BerichtSpiel {
  datum: string;
  gegner: string;
  team: string | null;
  ort: string | null;
}

export interface BerichtTor {
  zeit: string;
  stand: string;
  team: 'eigen' | 'gegner';
  schuetze: string | null;
  assist: string | null;
  situation: string | null;
}

export interface Spielbericht {
  titel: string;
  unter: string;
  resultat: { eigen: number; gegner: number };
  drittel: string[];
  ausgang: 'sieg' | 'niederlage' | 'unentschieden';
  tore: BerichtTor[];
  momente: string[];
  beste: { name: string; text: string }[];
  zahlen: { text: string; wert: string }[];
  text: string;
}

const SITUATION: Record<string, string> = {
  ueberzahl: 'Überzahl',
  unterzahl: 'Unterzahl',
  penalty: 'Penalty',
};

/** Spielzeit als Minute:Sekunde, sonst die Minute oder das Drittel */
function zeitText(e: Ereignis): string {
  if (e.zeit_sek != null) {
    const m = Math.floor(e.zeit_sek / 60);
    return `${String(m).padStart(2, '0')}:${String(e.zeit_sek % 60).padStart(2, '0')}`;
  }
  if (e.minute != null) return `${e.minute + 1}.`;
  if (e.drittel) return e.drittel === 4 ? 'V' : `${e.drittel}. Dr.`;
  return '';
}

/** Reihenfolge: Spielzeit, sonst Drittel und Minute, sonst Erfassung */
function zeitWert(e: Ereignis, i: number): number {
  if (e.zeit_sek != null) return e.zeit_sek;
  if (e.minute != null) return e.minute * 60 + 30;
  if (e.drittel) return (e.drittel - 1) * 1200 + 600 + i / 1000;
  return i;
}

const prozent = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('de-CH')} %`);

export function spielbericht(
  spiel: BerichtSpiel,
  ereignisse: Ereignis[],
  strafen: Strafe[],
  spieler: Spieler[],
): Spielbericht {
  const name = new Map(spieler.map((s) => [s.id, s.nummer != null ? `${s.name} (${s.nummer})` : s.name]));
  const kurz = new Map(spieler.map((s) => [s.id, s.name]));
  const eigenesTeam = spiel.team || 'Wir';
  const tore = ereignisse
    .map((e, i) => ({ e, t: zeitWert(e, i) }))
    .filter((x) => x.e.typ === 'tor')
    .sort((a, b) => a.t - b.t)
    .map((x) => x.e);

  // Torfolge mit Zwischenstand und Schlüsselmomenten
  let eigen = 0;
  let gegner = 0;
  let groessterRueckstand = 0;
  let groessterVorsprung = 0;
  let fuehrung: 'eigen' | 'gegner' | null = null;
  const momente: string[] = [];
  const liste: BerichtTor[] = [];
  let vorher: Ereignis | null = null;
  for (const e of tore) {
    if (e.team === 'eigen') eigen++;
    else gegner++;
    const stand = `${eigen}:${gegner}`;
    const wer = e.team === 'eigen' ? (e.spieler_id ? (kurz.get(e.spieler_id) ?? null) : null) : null;
    liste.push({
      zeit: zeitText(e),
      stand,
      team: e.team,
      schuetze: e.team === 'eigen' ? (e.spieler_id ? (name.get(e.spieler_id) ?? null) : null) : null,
      assist: e.team === 'eigen' && e.assist_id ? (name.get(e.assist_id) ?? null) : null,
      situation: e.situation && e.situation !== 'gleich' ? SITUATION[e.situation] : null,
    });
    const durch = e.team === 'eigen' ? (wer ? ` durch ${wer}` : '') : '';
    const vonWem = e.team === 'eigen' ? '' : ' des Gegners';
    const bei = zeitText(e) ? ` (${zeitText(e)})` : '';
    const neu = eigen > gegner ? 'eigen' : gegner > eigen ? 'gegner' : null;
    if (eigen + gegner === 1) momente.push(`Erstes Tor${vonWem} zum ${stand}${durch}${bei}`);
    else if (neu === null) momente.push(`Ausgleich${vonWem} zum ${stand}${durch}${bei}`);
    // Nach einem Ausgleich führt jetzt das andere Team
    else if (fuehrung !== null && neu !== fuehrung)
      momente.push(
        neu === 'eigen'
          ? `Wende: Führung zum ${stand}${durch}${bei}`
          : `Der Gegner dreht das Spiel zum ${stand}${bei}`,
      );
    if (
      vorher &&
      vorher.team === e.team &&
      e.zeit_sek != null &&
      vorher.zeit_sek != null &&
      e.zeit_sek - vorher.zeit_sek <= 90
    )
      momente.push(
        `Doppelschlag ${e.team === 'eigen' ? 'von uns' : 'des Gegners'} innert ${e.zeit_sek - vorher.zeit_sek} Sekunden`,
      );
    if (neu !== null) fuehrung = neu;
    groessterRueckstand = Math.max(groessterRueckstand, gegner - eigen);
    groessterVorsprung = Math.max(groessterVorsprung, eigen - gegner);
    vorher = e;
  }
  const ausgang = eigen > gegner ? 'sieg' : eigen < gegner ? 'niederlage' : 'unentschieden';
  if (ausgang === 'sieg') {
    // Siegtreffer: das eigene Tor, das einen Treffer mehr ergibt, als der Gegner am Schluss hat
    const t = liste.find((x) => x.team === 'eigen' && Number(x.stand.split(':')[0]) === gegner + 1);
    if (t)
      momente.push(
        `Siegtreffer zum ${t.stand}${t.schuetze ? ` durch ${t.schuetze.replace(/ \(\d+\)$/, '')}` : ''}${t.zeit ? ` (${t.zeit})` : ''}`,
      );
    if (groessterRueckstand >= 2) momente.push(`Aufholjagd nach ${groessterRueckstand} Toren Rückstand`);
  }
  if (ausgang === 'unentschieden' && groessterRueckstand >= 2)
    momente.push(`Punkt gerettet nach ${groessterRueckstand} Toren Rückstand`);
  if (ausgang !== 'sieg' && groessterVorsprung >= 2)
    momente.push(`Vorsprung von ${groessterVorsprung} Toren verspielt`);

  // Resultat pro Drittel
  const drittelNr = [...new Set([1, 2, 3, ...tore.map((e) => e.drittel ?? 0).filter((d) => d > 3)])];
  const mitDrittel = tore.some((e) => e.drittel);
  const drittel = mitDrittel
    ? drittelNr.map((d) => {
        const im = tore.filter((e) => e.drittel === d);
        return `${im.filter((e) => e.team === 'eigen').length}:${im.filter((e) => e.team === 'gegner').length}`;
      })
    : [];

  // Beste Spieler: Punkte, dann Plus Minus, dann Schüsse
  const beste = nachSpieler(ereignisse, spieler, strafen)
    .filter((s) => s.punkte > 0 || (s.plusMinus ?? 0) > 0)
    .sort(
      (a, b) =>
        b.punkte - a.punkte ||
        (b.plusMinus ?? 0) - (a.plusMinus ?? 0) ||
        b.tore - a.tore ||
        b.schuesse - a.schuesse,
    )
    .slice(0, 3)
    .map((s) => {
      const teile = [
        s.tore ? `${s.tore} ${s.tore === 1 ? 'Tor' : 'Tore'}` : null,
        s.assists ? `${s.assists} ${s.assists === 1 ? 'Assist' : 'Assists'}` : null,
        s.plusMinus != null ? `${s.plusMinus > 0 ? '+' : ''}${s.plusMinus}` : null,
        s.schuesse ? `${s.schuesse} Schüsse` : null,
      ].filter(Boolean);
      return { name: name.get(s.spieler.id) ?? s.spieler.name, text: teile.join(', ') };
    });

  const we = werte(ereignisse.filter((e) => e.team === 'eigen'));
  const wg = werte(ereignisse.filter((e) => e.team === 'gegner'));
  const sp = spezialteams(ereignisse, strafen);
  const zahlen = [
    { text: 'Schüsse', wert: `${we.schuesse}:${wg.schuesse}` },
    { text: 'Aufs Tor', wert: `${we.aufsTor}:${wg.aufsTor}` },
    { text: 'Effizienz', wert: `${prozent(we.effizienz)} : ${prozent(wg.effizienz)}` },
    ...(sp.ueberzahl.chancen
      ? [{ text: 'Überzahl', wert: `${sp.ueberzahl.tore} von ${sp.ueberzahl.chancen} genutzt` }]
      : []),
    ...(sp.unterzahl.chancen
      ? [
          {
            text: 'Unterzahl',
            wert: `${sp.unterzahl.chancen - Math.min(sp.unterzahl.gegentore, sp.unterzahl.chancen)} von ${sp.unterzahl.chancen} überstanden`,
          },
        ]
      : []),
    ...(sp.strafminuten.eigen + sp.strafminuten.gegner
      ? [{ text: 'Strafminuten', wert: `${sp.strafminuten.eigen}:${sp.strafminuten.gegner}` }]
      : []),
  ];

  const titel = `${eigenesTeam} gegen ${spiel.gegner} ${eigen}:${gegner}${drittel.length ? ` (${drittel.join(', ')})` : ''}`;
  const unter = [
    datumText(spiel.datum),
    spiel.ort === 'auswaerts' ? 'auswärts' : spiel.ort === 'heim' ? 'Heimspiel' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const zeilen = [titel, unter, ''];
  if (liste.length) {
    zeilen.push('Torfolge');
    for (const t of liste) zeilen.push(torZeile(t));
    zeilen.push('');
  }
  if (momente.length) {
    zeilen.push('Schlüsselmomente');
    for (const m of momente) zeilen.push(`· ${m}`);
    zeilen.push('');
  }
  if (beste.length) {
    zeilen.push('Beste Spieler');
    for (const b of beste) zeilen.push(`· ${b.name}: ${b.text}`);
    zeilen.push('');
  }
  zeilen.push('Zahlen (wir : Gegner)');
  for (const z of zahlen) zeilen.push(`· ${z.text}: ${z.wert}`);

  return {
    titel,
    unter,
    resultat: { eigen, gegner },
    drittel,
    ausgang,
    tore: liste,
    momente,
    beste,
    zahlen,
    text: zeilen.join('\n'),
  };
}

export function torZeile(t: BerichtTor): string {
  const wer =
    t.team === 'eigen' ? `${t.schuetze ?? 'unbekannt'}${t.assist ? ` (Assist ${t.assist})` : ''}` : 'Gegner';
  return `${t.zeit ? `${t.zeit}  ` : ''}${t.stand}  ${wer}${t.situation ? `, ${t.situation}` : ''}`;
}

function datumText(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-');
  return j && m && t ? `${Number(t)}.${Number(m)}.${j}` : iso;
}

/** Spielbericht als PDF, eine Seite A4 */
export function spielberichtPdf(b: Spielbericht): Buffer {
  const pdf = new Pdf();
  const RAND = 50;
  const AKZENT: [number, number, number] = [0.1, 0.55, 0.72];
  const GRAU: [number, number, number] = [0.42, 0.46, 0.52];
  const ROT: [number, number, number] = [0.75, 0.2, 0.2];
  let y = 60;
  const platz = (n: number) => {
    if (y + n > pdf.hoehe - 50) {
      pdf.neueSeite();
      y = 60;
    }
  };
  pdf.rechteck(0, 0, pdf.breite, 8, AKZENT);
  pdf.text(RAND, y, 'Spielbericht', { groesse: 11, farbe: AKZENT, fett: true });
  y += 26;
  y = pdf.absatz(RAND, y, pdf.breite - 2 * RAND, b.titel, { groesse: 18, fett: true });
  pdf.text(RAND, y, b.unter, { groesse: 11, farbe: GRAU });
  y += 30;
  const abschnitt = (t: string) => {
    platz(40);
    pdf.text(RAND, y, t, { groesse: 12, fett: true });
    y += 6;
    pdf.linie(RAND, y, pdf.breite - RAND, y);
    y += 16;
  };
  if (b.tore.length) {
    abschnitt('Torfolge');
    for (const t of b.tore) {
      platz(16);
      const farbe = t.team === 'eigen' ? undefined : ROT;
      pdf.text(RAND, y, t.zeit, { groesse: 10, farbe: GRAU });
      pdf.text(RAND + 50, y, t.stand, { groesse: 10, fett: true, farbe });
      pdf.text(RAND + 90, y, torZeile({ ...t, zeit: '', stand: '' }).trim(), { groesse: 10, farbe });
      y += 15;
    }
    y += 10;
  }
  if (b.momente.length) {
    abschnitt('Schlüsselmomente');
    for (const m of b.momente) {
      platz(16);
      y = pdf.absatz(RAND, y, pdf.breite - 2 * RAND, `· ${m}`, { groesse: 10 });
    }
    y += 10;
  }
  if (b.beste.length) {
    abschnitt('Beste Spieler');
    for (const s of b.beste) {
      platz(16);
      pdf.text(RAND, y, s.name, { groesse: 10, fett: true });
      pdf.text(RAND + 140, y, s.text, { groesse: 10 });
      y += 15;
    }
    y += 10;
  }
  abschnitt('Zahlen (wir : Gegner)');
  for (const z of b.zahlen) {
    platz(16);
    pdf.text(RAND, y, z.text, { groesse: 10, farbe: GRAU });
    pdf.text(RAND + 140, y, z.wert, { groesse: 10 });
    y += 15;
  }
  platz(30);
  pdf.text(RAND, pdf.hoehe - 40, 'Aus der eigenen Live Erfassung im Pi Hub', { groesse: 8, farbe: GRAU });
  return pdf.erstellen(`Spielbericht ${b.titel}`);
}
