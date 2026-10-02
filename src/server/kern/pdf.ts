// Minimaler PDF Erzeuger (PDF 1.4) mit den Standardschriften Helvetica und Helvetica Bold.
// Reicht für Berichte mit Text, Linien und Flächen, ohne Zusatzpakete. Zeichensatz WinAnsi (Umlaute ok).

type Farbe = [number, number, number];

interface TextOptionen {
  groesse?: number;
  fett?: boolean;
  farbe?: Farbe;
  rechts?: boolean;
}

// Breiten der Helvetica Zeichen (1/1000 em) für ASCII 32 bis 126, aus den Adobe AFM Metriken
const BREITEN_NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BREITEN_FETT = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278,
  556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584,
  556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556,
  333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Text in WinAnsi Bytes, nicht darstellbare Zeichen werden ersetzt */
export function winAnsi(text: string): number[] {
  const sonder: Record<string, number> = {
    '€': 0x80,
    '–': 0x96,
    '—': 0x97,
    '‘': 0x91,
    '’': 0x92,
    '“': 0x93,
    '”': 0x94,
    '•': 0x95,
    '…': 0x85,
  };
  const aus: number[] = [];
  for (const z of text.normalize('NFC')) {
    const c = z.codePointAt(0)!;
    if (sonder[z] !== undefined) aus.push(sonder[z]);
    else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) aus.push(c);
    else if (c === 9) aus.push(32);
    else aus.push(63);
  }
  return aus;
}

export function textBreite(text: string, groesse: number, fett = false): number {
  const b = fett ? BREITEN_FETT : BREITEN_NORMAL;
  return winAnsi(text).reduce((s, c) => s + (c >= 32 && c <= 126 ? b[c - 32] : 556), 0) * (groesse / 1000);
}

function zeichenkette(bytes: number[]): string {
  return bytes
    .map((c) => {
      if (c === 40 || c === 41 || c === 92) return `\\${String.fromCharCode(c)}`;
      if (c < 32 || c > 126) return `\\${c.toString(8).padStart(3, '0')}`;
      return String.fromCharCode(c);
    })
    .join('');
}

export class Pdf {
  readonly breite = 595.28;
  readonly hoehe = 841.89;
  private seiten: string[][] = [];

  constructor() {
    this.neueSeite();
  }

  neueSeite() {
    this.seiten.push([]);
  }

  private get inhalt() {
    return this.seiten[this.seiten.length - 1];
  }

  /** y wird von oben gemessen */
  text(x: number, y: number, text: string, o: TextOptionen = {}) {
    const g = o.groesse ?? 10;
    const f = o.farbe ?? [0.1, 0.12, 0.15];
    const xx = o.rechts ? x - textBreite(text, g, o.fett) : x;
    this.inhalt.push(
      `BT ${f.map((n) => n.toFixed(3)).join(' ')} rg /${o.fett ? 'F2' : 'F1'} ${g} Tf ${xx.toFixed(2)} ${(this.hoehe - y).toFixed(2)} Td (${zeichenkette(winAnsi(text))}) Tj ET`,
    );
  }

  /** Bricht Text auf die Breite um und gibt die neue y Position zurück */
  absatz(x: number, y: number, breite: number, text: string, o: TextOptionen = {}): number {
    const g = o.groesse ?? 10;
    let zeile = '';
    let yy = y;
    for (const wort of text.split(/\s+/)) {
      const neu = zeile ? `${zeile} ${wort}` : wort;
      if (textBreite(neu, g, o.fett) > breite && zeile) {
        this.text(x, yy, zeile, o);
        yy += g * 1.35;
        zeile = wort;
      } else zeile = neu;
    }
    if (zeile) {
      this.text(x, yy, zeile, o);
      yy += g * 1.35;
    }
    return yy;
  }

  linie(x1: number, y1: number, x2: number, y2: number, farbe: Farbe = [0.85, 0.87, 0.9], dicke = 0.6) {
    this.inhalt.push(
      `${farbe.map((n) => n.toFixed(3)).join(' ')} RG ${dicke} w ${x1.toFixed(2)} ${(this.hoehe - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.hoehe - y2).toFixed(2)} l S`,
    );
  }

  rechteck(x: number, y: number, b: number, h: number, farbe: Farbe) {
    this.inhalt.push(
      `${farbe.map((n) => n.toFixed(3)).join(' ')} rg ${x.toFixed(2)} ${(this.hoehe - y - h).toFixed(2)} ${b.toFixed(2)} ${h.toFixed(2)} re f`,
    );
  }

  erstellen(titel = 'Bericht'): Buffer {
    const objekte: string[] = [];
    const fontNormal = 3;
    const fontFett = 4;
    objekte[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objekte[fontNormal] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objekte[fontFett] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objekte[5] = `<< /Title (${zeichenkette(winAnsi(titel))}) /Producer (Pi Hub) >>`;
    const kinder: number[] = [];
    let nr = 6;
    const streams = new Map<number, string>();
    for (const s of this.seiten) {
      const seite = nr++;
      const inhalt = nr++;
      kinder.push(seite);
      objekte[seite] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.breite} ${this.hoehe}] /Resources << /Font << /F1 ${fontNormal} 0 R /F2 ${fontFett} 0 R >> >> /Contents ${inhalt} 0 R >>`;
      streams.set(inhalt, s.join('\n'));
    }
    objekte[2] = `<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(' ')}] /Count ${kinder.length} >>`;
    const teile: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets: number[] = [];
    let laenge = teile[0].length;
    for (let i = 1; i < nr; i++) {
      offsets[i] = laenge;
      let b: Buffer;
      const stream = streams.get(i);
      if (stream !== undefined) {
        const daten = Buffer.from(stream, 'latin1');
        b = Buffer.concat([
          Buffer.from(`${i} 0 obj\n<< /Length ${daten.length} >>\nstream\n`, 'latin1'),
          daten,
          Buffer.from('\nendstream\nendobj\n', 'latin1'),
        ]);
      } else {
        b = Buffer.from(`${i} 0 obj\n${objekte[i]}\nendobj\n`, 'latin1');
      }
      teile.push(b);
      laenge += b.length;
    }
    const xref = [`xref\n0 ${nr}\n0000000000 65535 f \n`];
    for (let i = 1; i < nr; i++) xref.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${nr} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${laenge}\n%%EOF\n`);
    teile.push(Buffer.from(xref.join(''), 'latin1'));
    return Buffer.concat(teile);
  }
}
