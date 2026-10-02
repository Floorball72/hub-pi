// Demo Daten für scont. Erfundene Kunden mit reservierten .example Domains, klar als Demo gekennzeichnet.
import type { Daten } from '../../daten/index.ts';
import { lokalDatum } from '../../kern/zeit.ts';
import type { PageSpeedWerte, PruefErgebnis, QualitaetsErgebnis, SslErgebnis } from './pruefen.ts';

/** Einfacher, reproduzierbarer Zufall aus einem Text */
export function zufall(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function demoPruefung(name: string): PruefErgebnis {
  const basis = 180 + Math.round(zufall(name) * 300);
  const ms = basis + Math.round(Math.random() * 120);
  return { ok: true, status: 200, ms, fehler: null };
}

export function demoSsl(host: string): SslErgebnis {
  const tage = host.includes('velo') ? 9 : 40 + Math.round(zufall(host) * 50);
  return {
    gueltigBis: new Date(Date.now() + tage * 86400000).toISOString(),
    aussteller: "Let's Encrypt",
    fehler: null,
  };
}

export function demoPagespeed(url: string): PageSpeedWerte {
  const z = zufall(url);
  return {
    performance: 62 + Math.round(z * 35),
    barrierefreiheit: 85 + Math.round(z * 14),
    best_practices: 90 + Math.round(z * 10),
    seo: 88 + Math.round(z * 12),
    lcp_ms: 1400 + Math.round((1 - z) * 1800),
    cls: Math.round(z * 0.15 * 1000) / 1000,
    tbt_ms: 40 + Math.round((1 - z) * 300),
  };
}

export function demoQualitaet(url: string): QualitaetsErgebnis {
  const gut = zufall(url) > 0.4;
  const header = [
    { name: 'strict-transport-security', vorhanden: true, empfehlung: 'HSTS setzen', gewicht: 20 },
    {
      name: 'content-security-policy',
      vorhanden: gut,
      empfehlung: 'Content Security Policy definieren',
      gewicht: 20,
    },
    { name: 'x-content-type-options', vorhanden: true, empfehlung: '«nosniff» setzen', gewicht: 10 },
    { name: 'x-frame-options', vorhanden: gut, empfehlung: '«SAMEORIGIN» setzen', gewicht: 10 },
    { name: 'referrer-policy', vorhanden: true, empfehlung: 'Referrer Policy setzen', gewicht: 10 },
    {
      name: 'permissions-policy',
      vorhanden: false,
      empfehlung: 'Nicht benötigte Browser Funktionen abschalten',
      gewicht: 5,
    },
  ];
  const punkte = header.filter((h) => h.vorhanden).reduce((s, h) => s + h.gewicht, 0) + 25 - (gut ? 0 : 5);
  return {
    header,
    https: true,
    cookie: { gefunden: true, loesung: gut ? 'Cookiebot' : null },
    links: {
      geprueft: 32,
      defekt: gut ? [] : [{ url: `${url.replace(/\/$/, '')}/alte-aktion`, status: 404 }],
    },
    punkte,
    note: punkte >= 90 ? 'A' : punkte >= 75 ? 'B' : 'C',
    vorschlaege: header.filter((h) => !h.vorhanden).map((h) => `${h.name}: ${h.empfehlung}`),
  };
}

export async function demoDatenAnlegen(daten: Daten, jetzt: Date) {
  const tag = (n: number) => lokalDatum(new Date(jetzt.getTime() + n * 86400000));
  const [baeckerei, velo, verein] = await daten.einfuegen<{ id: string }>('kunden', [
    { name: 'Bäckerei Beispiel', status: 'aktiv', stundensatz: 110, notizen: 'Demo Kunde' },
    { name: 'Velo Muster GmbH', status: 'aktiv', stundensatz: 120, notizen: 'Demo Kunde' },
    { name: 'Turnverein Demo', status: 'aktiv', stundensatz: 90, notizen: 'Demo Kunde' },
  ]);
  const seiten = await daten.einfuegen<{ id: string; name: string }>('seiten', [
    {
      name: 'Bäckerei Website',
      url: 'https://baeckerei.example',
      kunde_id: baeckerei.id,
      aktiv: true,
      intervall_min: 5,
      oeffentlich: true,
      oeffentlicher_name: 'Bäckerei Beispiel',
    },
    {
      name: 'Velo Shop',
      url: 'https://velo-muster.example',
      kunde_id: velo.id,
      aktiv: true,
      intervall_min: 5,
      oeffentlich: true,
      oeffentlicher_name: 'Velo Muster',
    },
    {
      name: 'Turnverein',
      url: 'https://tv-demo.example',
      kunde_id: verein.id,
      aktiv: true,
      intervall_min: 10,
      oeffentlich: false,
    },
    {
      name: 'scont.ch (eigene)',
      url: 'https://scont.example',
      aktiv: true,
      intervall_min: 5,
      oeffentlich: false,
    },
  ]);
  await daten.einfuegen('domains', [
    {
      name: 'baeckerei.example',
      kunde_id: baeckerei.id,
      registrar: 'Demo Registrar',
      ablauf: tag(21),
      kosten_jahr: 18,
    },
    {
      name: 'velo-muster.example',
      kunde_id: velo.id,
      registrar: 'Demo Registrar',
      ablauf: tag(140),
      kosten_jahr: 18,
    },
    {
      name: 'tv-demo.example',
      kunde_id: verein.id,
      registrar: 'Demo Registrar',
      ablauf: tag(260),
      kosten_jahr: 15,
    },
    { name: 'scont.example', registrar: 'Demo Registrar', ablauf: tag(300), kosten_jahr: 20, eigene: true },
  ]);
  await daten.einfuegen('kosten', [
    {
      bezeichnung: 'Webhosting Paket',
      art: 'Hosting',
      anbieter: 'Demo Hosting',
      betrag: 14.9,
      intervall: 'monatlich',
      naechste_zahlung: tag(9),
      weiterverrechnet: true,
      kunde_id: baeckerei.id,
    },
    {
      bezeichnung: 'Design Abo',
      art: 'Abo',
      anbieter: 'Demo Software',
      betrag: 239,
      intervall: 'jährlich',
      naechste_zahlung: tag(45),
    },
    {
      bezeichnung: 'Domain baeckerei.example',
      art: 'Domain',
      anbieter: 'Demo Registrar',
      betrag: 18,
      intervall: 'jährlich',
      naechste_zahlung: tag(21),
      kunde_id: baeckerei.id,
      weiterverrechnet: true,
    },
    {
      bezeichnung: 'Shop Plugin Lizenz',
      art: 'Lizenz',
      anbieter: 'Demo Plugins',
      betrag: 79,
      intervall: 'jährlich',
      naechste_zahlung: tag(110),
      kunde_id: velo.id,
    },
  ]);
  // Verlauf: 7 Tage, alle 30 Minuten
  const zeilen: Record<string, unknown>[] = [];
  for (const s of seiten) {
    const basis = 180 + Math.round(zufall(s.name) * 300);
    for (let i = 7 * 48; i > 0; i--) {
      const zeit = new Date(jetzt.getTime() - i * 1800000);
      const stunde = zeit.getUTCHours();
      const ausfall = s.name === 'Velo Shop' && i > 100 && i <= 102;
      zeilen.push({
        seite_id: s.id,
        erstellt: zeit.toISOString(),
        ok: !ausfall,
        status: ausfall ? 503 : 200,
        ms: ausfall
          ? null
          : basis + Math.round(zufall(`${s.id}${i}`) * 140) + (stunde > 7 && stunde < 18 ? 60 : 0),
        fehler: ausfall ? 'HTTP 503' : null,
      });
    }
  }
  await daten.einfuegen('pruefungen', zeilen);
  const velosShop = seiten.find((s) => s.name === 'Velo Shop')!;
  await daten.einfuegen('vorfaelle', [
    {
      seite_id: velosShop.id,
      start: new Date(jetzt.getTime() - 102 * 1800000).toISOString(),
      ende: new Date(jetzt.getTime() - 100 * 1800000).toISOString(),
      grund: 'HTTP 503',
    },
  ]);
  for (const s of seiten) {
    const ps: Record<string, unknown>[] = [];
    for (let t = 14; t >= 0; t--) {
      const w = demoPagespeed(`${s.name}`);
      ps.push({
        seite_id: s.id,
        strategie: 'mobile',
        ...w,
        performance: Math.min(100, (w.performance ?? 70) + Math.round((zufall(`${s.id}${t}`) - 0.5) * 10)),
        erstellt: new Date(jetzt.getTime() - t * 86400000).toISOString(),
      });
    }
    await daten.einfuegen('pagespeed', ps);
    const q = demoQualitaet(s.name);
    await daten.einfuegen('qualitaet', [{ seite_id: s.id, punkte: q.punkte, note: q.note, ergebnis: q }]);
    const host = s.name === 'Velo Shop' ? 'velo' : s.name;
    const ssl = demoSsl(host);
    await daten.einfuegen('ssl_status', [
      { seite_id: s.id, gueltig_bis: ssl.gueltigBis, aussteller: ssl.aussteller },
    ]);
  }
}
