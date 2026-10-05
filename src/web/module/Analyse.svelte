<script lang="ts">
  import GegnerCheck from '../komponenten/GegnerCheck.svelte';
  import Linie from '../komponenten/Linie.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import Spielfeld from '../komponenten/Spielfeld.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { laufendeStrafen, type Strafe, situationAus, strafeEndetDurchTor } from '../../server/geteilt/unihockey.ts';
  import { ApiFehler, api, fehlerText } from '../lib/api.ts';
  import { datum } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Spieler { id: string; nummer: number | null; name: string; position: string | null; aktiv?: boolean; block?: number | null }
  interface Spiel { id: string; datum: string; gegner: string; team: string | null; ort: string | null; saison: string | null; drittel_min?: number | null; resultat: { eigen: number; gegner: number }; schuesse: { eigen: number; gegner: number } }
  interface Ereignis { id: string; typ: string; team: string; x: number; y: number; spieler_id: string | null; assist_id?: string | null; drittel?: number | null; minute?: number | null; situation?: string | null; auf_feld?: string | null; zeit_sek?: number | null }
  interface Werte { schuesse: number; tore: number; aufsTor: number; geblockt: number; daneben: number; effizienz: number | null; praezision: number | null }
  interface Auswertung {
    eigen: Werte;
    gegner: Werte;
    zonenEigen: ({ zone: string } & Werte)[];
    zonenGegner: ({ zone: string } & Werte)[];
    drittel: { drittel: number; eigen: Werte; gegner: Werte }[];
    spieler: ({ spieler: Spieler; assists: number; punkte: number; spiele: number; distanz: number | null; plusMinus: number | null; strafminuten: number } & Werte)[];
    spezial: {
      ueberzahl: { chancen: number; tore: number; quote: number | null };
      unterzahl: { chancen: number; gegentore: number; quote: number | null };
      strafminuten: { eigen: number; gegner: number };
    };
    bloecke: { bloecke: BlockWerte[]; aufstellungen: BlockWerte[]; ohneFeld: number };
    spiele: number;
    ereignisse: Ereignis[];
  }

  interface BlockWerte {
    block: number | null;
    name: string;
    spieler: string[];
    ereignisse: number;
    schuesseFuer: number;
    schuesseGegen: number;
    anteil: number | null;
    toreFuer: number;
    toreGegen: number;
    plusMinus: number;
    effizienz: number | null;
  }

  const TYPEN = [
    { id: 'tor', name: 'Tor' },
    { id: 'gehalten', name: 'Gehalten' },
    { id: 'daneben', name: 'Daneben' },
    { id: 'geblockt', name: 'Geblockt' },
  ];
  const TYP_NAME: Record<string, string> = Object.fromEntries(TYPEN.map((t) => [t.id, t.name]));
  const DRITTEL = [1, 2, 3, 4];
  const drittelName = (d: number) => (d === 4 ? 'V' : `${d}.`);

  let tab = $state('Erfassen');
  let u = $state<{ spiele: Spiel[]; spieler: Spieler[]; saisons: string[] } | null>(null);

  async function uebersichtLaden() {
    u = await api.get('/api/m/analyse/uebersicht');
  }
  // Neu laden beim Tab Wechsel und nach Änderungen in den Editoren für Spiele und Kader
  let spielZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let spielerZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  $effect(() => {
    void tab;
    void JSON.stringify(spielZeilen);
    void JSON.stringify(spielerZeilen);
    uebersichtLaden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const spielerName = (id: string | null | undefined) => {
    const s = u?.spieler.find((x) => x.id === id);
    return s ? `${s.nummer ?? ''} ${s.name}`.trim() : '';
  };
  const kader = $derived((u?.spieler ?? []).filter((s) => s.aktiv !== false && s.position !== 'Torhüter'));

  // ---------- Erfassen ----------
  let spielId = $state<string>(lesen('analyse.spiel', ''));
  let ereignisse = $state<Ereignis[]>([]);
  let team = $state<'eigen' | 'gegner'>('eigen');
  let situation = $state('gleich');
  let situationManuell = $state(false);
  let minute = $state<number | null>(null);
  let schuetze = $state<string | null>(null);
  let assist = $state<string>('');
  let markierung = $state<{ x: number; y: number } | null>(null);
  let speichert = $state(false);

  $effect(() => {
    if (u && !u.spiele.some((s) => s.id === spielId)) spielId = u.spiele[0]?.id ?? '';
  });
  $effect(() => {
    schreiben('analyse.spiel', spielId);
    if (tab === 'Erfassen' && u?.spiele.some((s) => s.id === spielId)) spielLaden(spielId).catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  async function spielLaden(id: string) {
    const d = await api.get<{ ereignisse: Ereignis[]; strafen: Strafe[] }>(`/api/m/analyse/spiel/${id}`);
    if (id !== spielId) return;
    // Noch nicht gesendete Abschlüsse dieses Spiels dazu
    ereignisse = [...d.ereignisse, ...warteschlange.filter((w) => w.spielId === id).map((w) => w.zeile)];
    strafen = d.strafen;
  }

  // ---------- Spieluhr ----------
  // Läuft im Browser und bleibt pro Spiel gespeichert, auch wenn das Handy die Seite neu lädt.
  interface Uhr { drittel: number; sek: number; seit: number | null }
  const NEUE_UHR: Uhr = { drittel: 1, sek: 0, seit: null };
  let uhr = $state<Uhr>({ ...NEUE_UHR });
  let uhrFuer = '';
  let jetzt = $state(Date.now());
  $effect(() => {
    if (spielId !== uhrFuer && u?.spiele.some((s) => s.id === spielId)) {
      uhr = lesen(`analyse.uhr.${spielId}`, { ...NEUE_UHR });
      uhrFuer = spielId;
    }
  });
  $effect(() => {
    const u = $state.snapshot(uhr);
    if (spielId && uhrFuer === spielId) schreiben(`analyse.uhr.${spielId}`, u);
  });
  $effect(() => {
    if (!uhr.seit) return;
    const t = setInterval(() => (jetzt = Date.now()), 500);
    return () => clearInterval(t);
  });
  const drittelSek = $derived((u?.spiele.find((s) => s.id === spielId)?.drittel_min ?? 20) * 60);
  // Verlängerung halb so lang wie ein Drittel (10 Minuten bei 20 Minuten Dritteln)
  const laengeSek = $derived(uhr.drittel === 4 ? drittelSek / 2 : drittelSek);
  const periodeSek = $derived(
    Math.min(laengeSek, Math.floor(uhr.sek + (uhr.seit ? Math.max(0, jetzt - uhr.seit) / 1000 : 0))),
  );
  const spielSek = $derived((uhr.drittel - 1) * drittelSek + periodeSek);
  const uhrBenutzt = $derived(uhr.seit !== null || uhr.sek > 0);
  const minuteWert = $derived(uhrBenutzt ? Math.floor(spielSek / 60) : minute);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  $effect(() => {
    if (uhr.seit && periodeSek >= laengeSek) {
      uhr = { ...uhr, sek: laengeSek, seit: null };
      melden(uhr.drittel === 4 ? 'Verlängerung zu Ende' : `${uhr.drittel}. Drittel zu Ende`, 'ok');
    }
  });

  function uhrStartStop() {
    if (uhr.seit) uhr = { ...uhr, sek: periodeSek, seit: null };
    else if (periodeSek < laengeSek) {
      jetzt = Date.now();
      uhr = { ...uhr, seit: jetzt };
    }
  }
  function uhrKorrigieren(d: number) {
    jetzt = Date.now();
    uhr = { ...uhr, sek: Math.max(0, Math.min(laengeSek, periodeSek + d)), seit: uhr.seit ? jetzt : null };
  }
  function drittelWaehlen(d: number) {
    if (d !== uhr.drittel) uhr = { drittel: d, sek: 0, seit: null };
  }

  // ---------- Blöcke und Plus Minus ----------
  let aufFeld = $state<string[]>([]);
  let aktiverBlock = $state<number | null>(null);
  const bloecke = $derived(
    [...new Set(kader.map((s) => s.block).filter((b): b is number => b != null))].sort((a, b) => a - b),
  );
  function blockWaehlen(b: number) {
    aktiverBlock = b;
    aufFeld = kader.filter((s) => s.block === b).map((s) => s.id);
  }
  function feldUmschalten(id: string) {
    aktiverBlock = null;
    aufFeld = aufFeld.includes(id) ? aufFeld.filter((x) => x !== id) : [...aufFeld, id];
  }
  let wechselOffen = $state(false);
  // Spieler auf dem Feld zuerst, dann der Rest
  const schuetzen = $derived(
    [...kader].sort((a, b) => Number(aufFeld.includes(b.id)) - Number(aufFeld.includes(a.id))),
  );

  // ---------- Strafen ----------
  let strafen = $state<Strafe[]>([]);
  let strafSpieler = $state('');
  const laufend = $derived(laufendeStrafen(strafen, spielSek));
  const situationAuto = $derived(uhrBenutzt ? situationAus(strafen, spielSek) : null);
  $effect(() => {
    if (situationAuto && !situationManuell && situation !== situationAuto) situation = situationAuto;
  });
  function restZeit(s: Strafe) {
    return (s.ende_sek ?? (s.zeit_sek ?? 0) + s.minuten * 60) - spielSek;
  }

  async function strafeErfassen(t: 'eigen' | 'gegner', minuten: number) {
    if (!spielId) return;
    try {
      const neu = await api.post<Strafe>('/api/daten/analyse_strafen', {
        spiel_id: spielId,
        team: t,
        spieler_id: t === 'eigen' && strafSpieler ? strafSpieler : null,
        minuten,
        drittel: uhr.drittel,
        minute: minuteWert,
        zeit_sek: uhrBenutzt ? spielSek : null,
      });
      strafen = [...strafen, neu];
      strafSpieler = '';
      melden(`${minuten} Minuten ${t === 'eigen' ? 'gegen uns' : 'gegen den Gegner'}`, 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function strafeEntfernen(s: Strafe) {
    try {
      await api.del(`/api/daten/analyse_strafen/${s.id}?bestaetigt=ja`);
      strafen = strafen.filter((x) => x.id !== s.id);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  // ---------- Offline Puffer ----------
  // In der Halle ist das Netz oft schlecht. Abschlüsse bleiben im Browser, bis sie gesendet sind.
  interface Wartend { spielId: string; body: Record<string, unknown>; zeile: Ereignis }
  let warteschlange = $state<Wartend[]>(lesen('analyse.warteschlange', []));
  let sendet = false;
  $effect(() => schreiben('analyse.warteschlange', $state.snapshot(warteschlange)));

  async function nachsenden() {
    if (sendet || !warteschlange.length) return;
    sendet = true;
    try {
      while (warteschlange.length) {
        const w = warteschlange[0];
        try {
          const r = await api.post<{ ereignis: Ereignis }>(`/api/m/analyse/spiel/${w.spielId}/abschluss`, w.body);
          ereignisse = ereignisse.map((e) => (e.id === w.zeile.id ? r.ereignis : e));
        } catch (e) {
          if (!(e instanceof ApiFehler)) break;
          // Vom Server abgelehnt (z.B. Spiel gelöscht): verwerfen, damit die Schlange nicht hängt
          melden(`Abschluss verworfen: ${fehlerText(e)}`, 'ausfall');
        }
        warteschlange = warteschlange.slice(1);
      }
      if (!warteschlange.length) melden('Alle Abschlüsse gesendet', 'ok');
    } finally {
      sendet = false;
    }
  }
  $effect(() => {
    if (!warteschlange.length) return;
    const t = setInterval(nachsenden, 15000);
    window.addEventListener('online', nachsenden);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', nachsenden);
    };
  });

  const stand = $derived({
    eigen: ereignisse.filter((e) => e.team === 'eigen' && e.typ === 'tor').length,
    gegner: ereignisse.filter((e) => e.team === 'gegner' && e.typ === 'tor').length,
  });
  const aktuellesSpiel = $derived(u?.spiele.find((s) => s.id === spielId) ?? null);

  async function erfassen(typ: string) {
    if (!markierung || !spielId || speichert) return;
    speichert = true;
    const body = {
      typ,
      team,
      x: markierung.x,
      y: markierung.y,
      spieler_id: team === 'eigen' ? schuetze : null,
      assist_id: team === 'eigen' && typ === 'tor' && assist ? assist : null,
      drittel: uhr.drittel,
      minute: minuteWert,
      situation,
      auf_feld: aufFeld.length ? aufFeld.join(',') : null,
      zeit_sek: uhrBenutzt ? spielSek : null,
    };
    const fertig = () => {
      markierung = null;
      assist = '';
      situationManuell = false;
    };
    try {
      const r = await api.post<{ ereignis: Ereignis; strafeBeendet: string | null }>(
        `/api/m/analyse/spiel/${spielId}/abschluss`,
        body,
      );
      ereignisse = [...ereignisse, r.ereignis];
      if (r.strafeBeendet)
        strafen = strafen.map((s) => (s.id === r.strafeBeendet ? { ...s, ende_sek: body.zeit_sek } : s));
      fertig();
    } catch (e) {
      if (e instanceof ApiFehler) melden(fehlerText(e), 'ausfall');
      else {
        // Kein Netz: lokal behalten und später senden
        const zeile = { ...body, id: `lokal-${Date.now()}`, spiel_id: spielId } as Ereignis;
        warteschlange = [...warteschlange, { spielId, body, zeile }];
        ereignisse = [...ereignisse, zeile];
        if (typ === 'tor' && body.zeit_sek != null) {
          const s = strafeEndetDurchTor(strafen, team, body.zeit_sek);
          if (s) strafen = strafen.map((x) => (x.id === s.id ? { ...x, ende_sek: body.zeit_sek } : x));
        }
        fertig();
        melden('Kein Netz. Der Abschluss wird nachgesendet.', 'ausfall');
      }
    } finally {
      speichert = false;
    }
  }

  async function rueckgaengig() {
    const letztes = ereignisse.at(-1);
    if (!letztes) return;
    if (letztes.id.startsWith('lokal-')) {
      warteschlange = warteschlange.filter((w) => w.zeile.id !== letztes.id);
      ereignisse = ereignisse.slice(0, -1);
      return;
    }
    try {
      await api.del(`/api/daten/analyse_ereignisse/${letztes.id}?bestaetigt=ja`);
      ereignisse = ereignisse.slice(0, -1);
      melden('Letzter Abschluss entfernt', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  // ---------- Auswertung ----------
  let bereich = $state<string>(lesen('analyse.bereich', 'alle'));
  let sicht = $state<'eigen' | 'gegner'>('eigen');
  let nurSpieler = $state('');
  let darstellung = $state<'punkte' | 'heatmap'>('punkte');
  let a = $state<Auswertung | null>(null);

  $effect(() => {
    if (tab !== 'Auswertung' && tab !== 'Spieler') return;
    schreiben('analyse.bereich', bereich);
    const q = new URLSearchParams();
    if (bereich.startsWith('s:')) q.set('saison', bereich.slice(2));
    if (bereich.startsWith('g:')) q.set('spiel', bereich.slice(2));
    if (nurSpieler) q.set('spieler', nurSpieler);
    api
      .get<Auswertung>(`/api/m/analyse/auswertung?${q}`)
      .then((x) => (a = x))
      .catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const sichtbar = $derived((a?.ereignisse ?? []).filter((e) => (nurSpieler ? true : e.team === sicht)));
  const w = $derived(a ? (sicht === 'eigen' ? a.eigen : a.gegner) : null);
  const zonen = $derived(a ? (sicht === 'eigen' ? a.zonenEigen : a.zonenGegner) : []);
  const pct = (n: number | null) => (n === null ? '–' : `${n} %`);

  function spielOeffnen(id: string) {
    spielId = id;
    tab = 'Erfassen';
  }

  // Spielbericht
  interface Bericht {
    titel: string;
    unter: string;
    ausgang: string;
    tore: { zeit: string; stand: string; team: string; schuetze: string | null; assist: string | null; situation: string | null }[];
    momente: string[];
    beste: { name: string; text: string }[];
    zahlen: { text: string; wert: string }[];
    text: string;
  }
  let berichtSpiel = $state(lesen('analyse.bericht', ''));
  let bericht = $state<Bericht | null>(null);
  const berichtId = $derived(berichtSpiel || u?.spiele.find((s) => s.resultat.eigen + s.resultat.gegner > 0)?.id || '');
  $effect(() => {
    if (tab !== 'Bericht' || !berichtId) return;
    schreiben('analyse.bericht', berichtSpiel);
    bericht = null;
    api
      .get<Bericht>(`/api/m/analyse/spiel/${berichtId}/bericht`)
      .then((x) => (bericht = x))
      .catch((e) => melden(fehlerText(e), 'ausfall'));
  });
  async function berichtKopieren() {
    if (!bericht) return;
    try {
      await navigator.clipboard.writeText(bericht.text);
      melden('Spielbericht kopiert', 'ok');
    } catch {
      melden('Kopieren nicht möglich', 'ausfall');
    }
  }
  interface VerlaufSpiel {
    id: string;
    datum: string;
    gegner: string;
    tore: number;
    gegentore: number;
    ausgang: 'S' | 'U' | 'N';
    verlaengerung: boolean;
    punkte: number;
    punkteSumme: number;
    schuesse: number;
    schuesseGegen: number;
    ueberzahlQuote: number | null;
    unterzahlQuote: number | null;
  }
  interface Saison {
    saison: string | null;
    saisons: string[];
    team: string | null;
    teams: string[];
    spiele: VerlaufSpiel[];
    bilanz: { spiele: number; siege: number; unentschieden: number; niederlagen: number; punkte: number; punkteProSpiel: number | null; tore: number; gegentore: number };
    form: ('S' | 'U' | 'N')[];
    serie: string | null;
    drittel: { drittel: number; tore: number; gegentore: number }[];
    ueberzahl: { tore: number; chancen: number; quote: number | null };
    unterzahl: { gegentore: number; chancen: number; quote: number | null };
  }
  interface TabellenRang {
    rang: number;
    team: string;
    spiele: number | null;
    punkte: number | null;
  }
  let saisonWahl = $state(lesen('analyse.saison', ''));
  let teamWahl = $state('');
  let saison = $state<Saison | null>(null);
  let tabellenRang = $state<{ zeile: TabellenRang; teams: number } | null>(null);
  $effect(() => {
    if (tab !== 'Saison') return;
    schreiben('analyse.saison', saisonWahl);
    const q = new URLSearchParams({ saison: saisonWahl, team: teamWahl });
    api
      .get<Saison>(`/api/m/analyse/saison?${q}`)
      .then((x) => (saison = x))
      .catch((e) => melden(fehlerText(e), 'ausfall'));
  });
  // Vergleich mit der offiziellen Rangliste aus dem Unihockey Modul, falls es läuft
  const kern = (t: string) => t.toLowerCase().replace(/^(uhc|uh|fbc|sv|ufc)\s+/, '').trim();
  $effect(() => {
    const team = saison?.team;
    tabellenRang = null;
    if (!team) return;
    api
      .get<{ rangliste: { zeilen: TabellenRang[] } | null }[]>('/api/m/unihockey/uebersicht')
      .then((liste) => {
        for (const t of liste) {
          const zeilen = t.rangliste?.zeilen ?? [];
          const zeile = zeilen.find((z) => kern(z.team) === kern(team) || kern(z.team).includes(kern(team)) || kern(team).includes(kern(z.team)));
          if (zeile) {
            tabellenRang = { zeile, teams: zeilen.length };
            return;
          }
        }
      })
      .catch(() => {});
  });
  interface Vorbereitung {
    team: string | null;
    saison: string | null;
    spiele: number;
    form: ('S' | 'U' | 'N')[];
    staerken: { text: string; detail: string }[];
    schwaechen: { text: string; detail: string }[];
    gegner: string | null;
    direkt: { id: string; datum: string; gegner: string; tore: number; gegentore: number }[];
    letzter: { id: string; titel: string; unter: string; momente: string[]; beste: { name: string; text: string }[]; zahlen: { text: string; wert: string }[] } | null;
  }
  interface UhTeam {
    team: { id: string; name: string };
    naechstes: { zeit: string | null; heim: string; gast: string; ort: string | null } | null;
    rang: { team: string } | null;
  }
  let vorbereitung = $state<Vorbereitung | null>(null);
  let naechstes = $state<{ teamId: string; gegner: string; zeit: string | null; ort: string | null } | null>(null);
  const gleich = (a: string, b: string) => !!kern(a) && !!kern(b) && (kern(a) === kern(b) || kern(a).includes(kern(b)) || kern(b).includes(kern(a)));
  $effect(() => {
    if (tab !== 'Vorbereitung') return;
    (async () => {
      // Zuerst das eigene Team, dann das nächste Spiel aus dem Unihockey Modul, dann mit Gegner neu laden
      const v = await api.get<Vorbereitung>('/api/m/analyse/vorbereitung');
      vorbereitung = v;
      if (!v.team) return;
      const teams = await api.get<UhTeam[]>('/api/m/unihockey/uebersicht').catch(() => [] as UhTeam[]);
      const t = teams.find((x) => gleich(x.team.name, v.team ?? '') || (x.rang && gleich(x.rang.team, v.team ?? '')));
      const n = t?.naechstes;
      if (!t || !n) return;
      const eigen = [t.team.name, t.rang?.team ?? ''].filter(Boolean);
      const gegner = eigen.some((e) => gleich(n.heim, e)) ? n.gast : n.heim;
      naechstes = { teamId: t.team.id, gegner, zeit: n.zeit, ort: n.ort };
      const q = new URLSearchParams({ team: v.team, gegner });
      vorbereitung = await api.get<Vorbereitung>(`/api/m/analyse/vorbereitung?${q}`);
    })().catch((e) => melden(fehlerText(e), 'ausfall'));
  });
  const AUSGANG_NAME = { S: 'Sieg', U: 'Unentschieden', N: 'Niederlage' };
  const tagMonat = (t: number) => new Date(t).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
  function berichtOeffnen(id: string) {
    berichtSpiel = id;
    tab = 'Bericht';
  }
</script>

{#snippet blockTabelle(liste: BlockWerte[], ersteSpalte: string)}
  <table>
    <thead><tr><th>{ersteSpalte}</th><th>Schüsse</th><th>Anteil</th><th>Tore</th><th>+/−</th><th>Effizienz</th></tr></thead>
    <tbody>
      {#each liste as b (b.name)}
        <tr>
          <td>
            <div>{b.name}</div>
            {#if b.block != null && b.spieler.length}<div class="sehr-klein gedaempft">{b.spieler.join(', ')}</div>{/if}
          </td>
          <td class="zahl">{b.schuesseFuer}:{b.schuesseGegen}</td>
          <td class="zahl">{pct(b.anteil)}</td>
          <td class="zahl">{b.toreFuer}:{b.toreGegen}</td>
          <td class="zahl" class:plus={b.plusMinus > 0} class:minus={b.plusMinus < 0}><strong>{b.plusMinus > 0 ? `+${b.plusMinus}` : b.plusMinus}</strong></td>
          <td class="zahl">{pct(b.effizienz)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet bereichWahl()}
  <select bind:value={bereich} aria-label="Spiele">
    <option value="alle">Alle Spiele</option>
    {#each u?.saisons ?? [] as s (s)}<option value={`s:${s}`}>Saison {s}</option>{/each}
    {#each u?.spiele ?? [] as s (s.id)}<option value={`g:${s.id}`}>{datum(s.datum)} gegen {s.gegner}</option>{/each}
  </select>
{/snippet}

<ModulRahmen modulId="analyse" tabs={['Erfassen', 'Auswertung', 'Bericht', 'Saison', 'Vorbereitung', 'Spieler', 'Spiele']} bind:tab>
  {#if !u}
    <div class="laedt" style="height:320px"></div>
  {:else if tab === 'Erfassen'}
    {#if !u.spiele.length}
      <p class="leer">Noch kein Spiel. Unter «Spiele» ein Spiel anlegen, unter «Spieler» den Kader.</p>
      <button class="primaer" onclick={() => (tab = 'Spiele')}>Spiel anlegen</button>
    {:else}
      <div class="erfassen">
        <div class="stapel">
          <div class="panel stapel">
            <div class="zeile-zwischen">
              <select bind:value={spielId} aria-label="Spiel">
                {#each u.spiele as s (s.id)}<option value={s.id}>{datum(s.datum)} gegen {s.gegner}</option>{/each}
              </select>
              <div class="stand zahl">{stand.eigen}<span class="gedaempft">:</span>{stand.gegner}</div>
            </div>
            {#if aktuellesSpiel}<div class="sehr-klein gedaempft">{aktuellesSpiel.team ?? 'Wir'} · {aktuellesSpiel.ort === 'auswaerts' ? 'auswärts' : 'heim'} · {ereignisse.length} Abschlüsse erfasst</div>{/if}
            <div class="wahl">
              <button class:an={team === 'eigen'} onclick={() => (team = 'eigen')}>Wir schiessen</button>
              <button class:an={team === 'gegner'} onclick={() => (team = 'gegner')}>Gegner schiesst</button>
            </div>
            {#if warteschlange.length}<div class="marke warnung sehr-klein">{warteschlange.length === 1 ? "1 Abschluss wartet" : `${warteschlange.length} Abschlüsse warten`} auf Netz</div>{/if}
            <div class="uhr">
              <div class="uhr-zeit zahl" class:laeuft={uhr.seit}>{mmss(periodeSek)}</div>
              <div class="uhr-knoepfe">
                <button class="primaer" onclick={uhrStartStop} disabled={!uhr.seit && periodeSek >= laengeSek}>{uhr.seit ? 'Pause' : uhrBenutzt ? 'Weiter' : 'Start'}</button>
                <button class="leise klein" onclick={() => uhrKorrigieren(-10)} aria-label="10 Sekunden zurück">−10 s</button>
                <button class="leise klein" onclick={() => uhrKorrigieren(10)} aria-label="10 Sekunden vor">+10 s</button>
              </div>
            </div>
            <div class="zeile">
              <span class="klein gedaempft">Drittel</span>
              <div class="wahl">
                {#each DRITTEL as d (d)}<button class:an={uhr.drittel === d} onclick={() => drittelWaehlen(d)}>{drittelName(d)}</button>{/each}
              </div>
              {#if uhrBenutzt}
                <span class="sehr-klein gedaempft">{minuteWert}. Min</span>
              {:else}
                <input type="number" min="0" max="80" placeholder="Min" bind:value={minute} class="minute" aria-label="Minute" />
              {/if}
              <select bind:value={situation} onchange={() => (situationManuell = true)} aria-label="Situation">
                <option value="gleich">5 gegen 5</option>
                <option value="ueberzahl">Überzahl</option>
                <option value="unterzahl">Unterzahl</option>
                <option value="penalty">Penalty</option>
              </select>
            </div>
            {#if laufend.length}
              <div class="sehr-klein">
                {#each laufend as s (s.id)}<span class="marke {s.team === 'eigen' ? 'warnung' : 'ok'}">{s.team === 'eigen' ? 'Wir' : 'Gegner'} {s.minuten}′ noch {mmss(restZeit(s))}</span>{' '}{/each}
              </div>
            {/if}
            <div>
              <div class="zeile-zwischen">
                <span class="klein gedaempft">Auf dem Feld{aufFeld.length ? ` (${aufFeld.length})` : ''}</span>
                <button class="leise klein" onclick={() => (wechselOffen = !wechselOffen)}>{wechselOffen ? 'Fertig' : 'Anpassen'}</button>
              </div>
              <div class="wahl">
                {#each bloecke as b (b)}<button class:an={aktiverBlock === b} onclick={() => blockWaehlen(b)}>Block {b}</button>{/each}
                {#if !bloecke.length}<span class="sehr-klein gedaempft">Blöcke beim Kader unter «Spieler» eintragen, dann zählt Plus Minus.</span>{/if}
              </div>
              {#if wechselOffen}
                <div class="chips">
                  {#each kader as s (s.id)}<button class:an={aufFeld.includes(s.id)} onclick={() => feldUmschalten(s.id)}>{s.nummer ?? ''} {s.name}</button>{/each}
                </div>
              {/if}
            </div>
            {#if team === 'eigen'}
              <div>
                <div class="klein gedaempft">Schütze</div>
                <div class="chips">
                  <button class:an={schuetze === null} onclick={() => (schuetze = null)}>?</button>
                  {#each schuetzen as s (s.id)}
                    <button class:an={schuetze === s.id} class:feld={aufFeld.includes(s.id)} onclick={() => (schuetze = s.id)}>{s.nummer ?? ''} {s.name}</button>
                  {/each}
                </div>
                {#if !kader.length}<p class="sehr-klein gedaempft">Kader unter «Spieler» erfassen.</p>{/if}
              </div>
              <label class="klein">
                Assist bei Tor
                <select bind:value={assist}>
                  <option value="">keiner</option>
                  {#each kader.filter((s) => s.id !== schuetze) as s (s.id)}<option value={s.id}>{s.nummer ?? ''} {s.name}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
          <div class="panel stapel">
            <h3>Strafen</h3>
            <div class="zeile strafe">
              <span class="klein">Wir</span>
              <select bind:value={strafSpieler} aria-label="Bestrafter Spieler">
                <option value="">Spieler?</option>
                {#each kader as s (s.id)}<option value={s.id}>{s.nummer ?? ''} {s.name}</option>{/each}
              </select>
              {#each [2, 5, 10] as m (m)}<button onclick={() => strafeErfassen('eigen', m)}>{m}′</button>{/each}
            </div>
            <div class="zeile strafe">
              <span class="klein">Gegner</span>
              {#each [2, 5, 10] as m (m)}<button onclick={() => strafeErfassen('gegner', m)}>{m}′</button>{/each}
            </div>
            {#if strafen.length}
              <ul class="liste">
                {#each strafen as s (s.id)}
                  <li class="zeile klein">
                    <span class="wachsen">{s.team === 'eigen' ? spielerName(s.spieler_id) || 'Wir' : 'Gegner'} {s.minuten}′</span>
                    <span class="sehr-klein gedaempft">{s.zeit_sek != null ? mmss(s.zeit_sek) : ''}{s.ende_sek != null ? ' (Tor, vorzeitig zu Ende)' : ''}</span>
                    <button class="leise klein" onclick={() => strafeEntfernen(s)} aria-label="Strafe entfernen">✕</button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="sehr-klein gedaempft">Mit laufender Uhr stellt der Hub Überzahl und Unterzahl selbst ein. Ein Tor in Überzahl beendet eine 2 Minuten Strafe.</p>
          </div>
        </div>
        <div class="stapel">
          <Spielfeld punkte={ereignisse.filter((e) => e.team === team)} {markierung} ontipp={(x, y) => (markierung = { x, y })} />
          <div class="ausgang">
            {#each TYPEN as t (t.id)}
              <button class="ausgang-{t.id}" disabled={!markierung || speichert} onclick={() => erfassen(t.id)}>{t.name}</button>
            {/each}
          </div>
          <p class="sehr-klein gedaempft">{markierung ? 'Ausgang wählen, dann ist der Abschluss gespeichert.' : 'Auf das Feld tippen, wo der Abschluss war. Das Tor ist oben.'}</p>
          {#if ereignisse.length}
            <div class="panel">
              <div class="zeile-zwischen">
                <h3>Zuletzt</h3>
                <button class="leise klein" onclick={rueckgaengig}>Letzten entfernen</button>
              </div>
              <ul class="liste">
                {#each ereignisse.slice(-5).reverse() as e (e.id)}
                  <li class="zeile klein">
                    <span class="marke {e.typ === 'tor' ? 'ok' : ''}">{TYP_NAME[e.typ]}</span>
                    <span class="wachsen">{e.team === 'eigen' ? spielerName(e.spieler_id) || 'Wir' : 'Gegner'}{e.assist_id ? ` (Assist ${spielerName(e.assist_id)})` : ''}</span>
                    <span class="sehr-klein gedaempft">{e.drittel ? drittelName(e.drittel) : ''}{e.minute != null ? ` ${e.minute}'` : ''}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else if tab === 'Auswertung'}
    <div class="zeile filter">
      {@render bereichWahl()}
      <div class="wahl">
        <button class:an={sicht === 'eigen' && !nurSpieler} onclick={() => ((sicht = 'eigen'), (nurSpieler = ''))}>Unsere Abschlüsse</button>
        <button class:an={sicht === 'gegner' && !nurSpieler} onclick={() => ((sicht = 'gegner'), (nurSpieler = ''))}>Gegen uns</button>
      </div>
      <select bind:value={nurSpieler} aria-label="Spieler">
        <option value="">Alle Spieler</option>
        {#each u.spieler as s (s.id)}<option value={s.id}>{s.nummer ?? ''} {s.name}</option>{/each}
      </select>
      <div class="wahl">
        <button class:an={darstellung === 'punkte'} onclick={() => (darstellung = 'punkte')}>Punkte</button>
        <button class:an={darstellung === 'heatmap'} onclick={() => (darstellung = 'heatmap')}>Heatmap</button>
      </div>
    </div>
    {#if !a || !w}
      <div class="laedt" style="height:300px"></div>
    {:else}
      <div class="erfassen">
        <div class="stapel">
          <Spielfeld punkte={sichtbar} heatmap={darstellung === 'heatmap'} zonen farbe={sicht === 'gegner' && !nurSpieler ? 'var(--ausfall)' : 'var(--akzent)'} />
          <div class="legende sehr-klein gedaempft">
            <span><i class="l tor"></i>Tor</span><span><i class="l gehalten"></i>Gehalten</span><span><i class="l daneben"></i>Daneben</span><span><i class="l geblockt"></i>Geblockt</span>
          </div>
        </div>
        <div class="stapel">
          <div class="kennzahlen">
            <div class="panel"><div class="sehr-klein gedaempft">Schüsse</div><div class="zahl gross">{w.schuesse}</div><div class="sehr-klein gedaempft">{a.spiele} Spiele</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Tore</div><div class="zahl gross">{w.tore}</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Effizienz</div><div class="zahl gross">{pct(w.effizienz)}</div><div class="sehr-klein gedaempft">Tore pro Schuss</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Aufs Tor</div><div class="zahl gross">{pct(w.praezision)}</div><div class="sehr-klein gedaempft">{w.geblockt} geblockt, {w.daneben} daneben</div></div>
          </div>
          <div class="panel">
            <h3>Zonen {sicht === 'gegner' ? 'gegen uns' : ''}</h3>
            <table>
              <thead><tr><th>Zone</th><th>Schüsse</th><th>Tore</th><th>Effizienz</th></tr></thead>
              <tbody>
                {#each zonen as z (z.zone)}<tr><td>{z.zone}</td><td class="zahl">{z.schuesse}</td><td class="zahl">{z.tore}</td><td class="zahl">{pct(z.effizienz)}</td></tr>{/each}
              </tbody>
            </table>
            <p class="sehr-klein gedaempft">Torraum bis 5 m vom Tor, Slot zentral bis 10 m, Seite seitlich bis 10 m, Distanz weiter weg.</p>
          </div>
          <div class="kennzahlen">
            <div class="panel"><div class="sehr-klein gedaempft">Überzahl</div><div class="zahl gross">{pct(a.spezial.ueberzahl.quote)}</div><div class="sehr-klein gedaempft">{a.spezial.ueberzahl.tore} Tore aus {a.spezial.ueberzahl.chancen} Chancen</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Unterzahl überstanden</div><div class="zahl gross">{pct(a.spezial.unterzahl.quote)}</div><div class="sehr-klein gedaempft">{a.spezial.unterzahl.gegentore} Gegentore in {a.spezial.unterzahl.chancen} Unterzahlen</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Strafminuten</div><div class="zahl gross">{a.spezial.strafminuten.eigen}</div><div class="sehr-klein gedaempft">Gegner {a.spezial.strafminuten.gegner}</div></div>
          </div>
          <div class="panel">
            <h3>Nach Drittel</h3>
            <table>
              <thead><tr><th></th><th>Schüsse</th><th>Tore</th><th>Gegen uns</th><th>Gegentore</th></tr></thead>
              <tbody>
                {#each a.drittel as d (d.drittel)}<tr><td>{d.drittel === 4 ? 'Verl.' : `${d.drittel}. Drittel`}</td><td class="zahl">{d.eigen.schuesse}</td><td class="zahl">{d.eigen.tore}</td><td class="zahl">{d.gegner.schuesse}</td><td class="zahl">{d.gegner.tore}</td></tr>{/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    {/if}
  {:else if tab === 'Bericht'}
    <div class="zeile filter">
      <select bind:value={berichtSpiel} aria-label="Spiel">
        <option value="">Letztes erfasstes Spiel</option>
        {#each u.spiele as s (s.id)}<option value={s.id}>{datum(s.datum)} gegen {s.gegner}</option>{/each}
      </select>
      {#if bericht}
        <button onclick={berichtKopieren}>Text kopieren</button>
        <a class="knopf" href={`/api/m/analyse/spiel/${berichtId}/bericht.pdf`} target="_blank" rel="noopener">PDF</a>
      {/if}
    </div>
    {#if !berichtId}
      <p class="leer">Noch kein Spiel erfasst.</p>
    {:else if !bericht}
      <div class="laedt" style="height:300px"></div>
    {:else}
      <div class="panel bericht" class:sieg={bericht.ausgang === 'sieg'} class:niederlage={bericht.ausgang === 'niederlage'}>
        <h2>{bericht.titel}</h2>
        <div class="sehr-klein gedaempft">{bericht.unter}</div>
      </div>
      <div class="erfassen" style="margin-top:12px">
        <div class="stapel">
          <h3>Torfolge</h3>
          <div class="panel">
            <ul class="liste">
              {#each bericht.tore as t, i (i)}
                <li class="zeile tor" class:gegen={t.team === 'gegner'}>
                  <span class="sehr-klein gedaempft zahl zeit">{t.zeit}</span>
                  <strong class="zahl">{t.stand}</strong>
                  <span class="wachsen">
                    {t.team === 'eigen' ? (t.schuetze ?? 'unbekannt') : 'Gegner'}
                    {#if t.assist}<span class="sehr-klein gedaempft"> Assist {t.assist}</span>{/if}
                  </span>
                  {#if t.situation}<span class="sehr-klein gedaempft">{t.situation}</span>{/if}
                </li>
              {:else}<li class="leer">Keine Tore erfasst.</li>{/each}
            </ul>
          </div>
        </div>
        <div class="stapel">
          {#if bericht.momente.length}
            <h3>Schlüsselmomente</h3>
            <div class="panel"><ul class="liste">{#each bericht.momente as m, i (i)}<li>{m}</li>{/each}</ul></div>
          {/if}
          {#if bericht.beste.length}
            <h3>Beste Spieler</h3>
            <div class="panel">
              <ul class="liste">{#each bericht.beste as b, i (i)}<li class="zeile"><strong class="wachsen">{b.name}</strong><span class="sehr-klein gedaempft">{b.text}</span></li>{/each}</ul>
            </div>
          {/if}
          <h3>Zahlen <span class="sehr-klein gedaempft">wir : Gegner</span></h3>
          <div class="panel">
            <ul class="liste">{#each bericht.zahlen as z, i (i)}<li class="zeile"><span class="wachsen">{z.text}</span><strong class="zahl">{z.wert}</strong></li>{/each}</ul>
          </div>
        </div>
      </div>
    {/if}
  {:else if tab === 'Saison'}
    <div class="zeile filter">
      <select bind:value={saisonWahl} aria-label="Saison">
        <option value="">Neueste Saison</option>
        {#each saison?.saisons ?? [] as s (s)}<option value={s}>{s}</option>{/each}
      </select>
      {#if (saison?.teams.length ?? 0) > 1}
        <select bind:value={teamWahl} aria-label="Team">
          <option value="">{saison?.teams[0]}</option>
          {#each saison?.teams.slice(1) ?? [] as t (t)}<option value={t}>{t}</option>{/each}
        </select>
      {/if}
    </div>
    {#if !saison}
      <p class="laedt">Lade Saisonverlauf…</p>
    {:else if !saison.spiele.length}
      <p class="leer">Noch keine erfassten Spiele in dieser Saison.</p>
    {:else}
      {@const b = saison.bilanz}
      <div class="kennzahlen">
        <div class="panel">
          <div class="sehr-klein gedaempft">Bilanz {saison.team ?? ''}</div>
          <div class="zahl gross">{b.siege} · {b.unentschieden} · {b.niederlagen}</div>
          <div class="sehr-klein gedaempft">Siege, Unentschieden, Niederlagen</div>
        </div>
        <div class="panel">
          <div class="sehr-klein gedaempft">Punkte</div>
          <div class="zahl gross">{b.punkte}</div>
          <div class="sehr-klein gedaempft">{b.punkteProSpiel ?? '–'} pro Spiel, Tore {b.tore}:{b.gegentore}</div>
        </div>
        <div class="panel">
          <div class="sehr-klein gedaempft">Form</div>
          <div class="form">
            {#each saison.form as f, i (i)}<span class="f-{f}" title={AUSGANG_NAME[f]}>{f}</span>{/each}
          </div>
          <div class="sehr-klein gedaempft">{saison.serie ?? 'Letzte Spiele, das neueste rechts'}</div>
        </div>
        <div class="panel">
          <div class="sehr-klein gedaempft">Überzahl</div>
          <div class="zahl gross">{pct(saison.ueberzahl.quote)}</div>
          <div class="sehr-klein gedaempft">{saison.ueberzahl.tore} von {saison.ueberzahl.chancen} genutzt</div>
        </div>
        <div class="panel">
          <div class="sehr-klein gedaempft">Unterzahl überstanden</div>
          <div class="zahl gross">{pct(saison.unterzahl.quote)}</div>
          <div class="sehr-klein gedaempft">{saison.unterzahl.gegentore} Gegentore in {saison.unterzahl.chancen} Unterzahlen</div>
        </div>
      </div>
      {#if tabellenRang}
        {@const z = tabellenRang.zeile}
        <div class="panel sehr-klein">
          Rangliste: Rang {z.rang} von {tabellenRang.teams}, {z.punkte ?? '–'} Punkte aus {z.spiele ?? '–'} Spielen{#if z.punkte != null && z.spiele}&nbsp;({Math.round((z.punkte / z.spiele) * 100) / 100} pro Spiel){/if}.
          In den {b.spiele} erfassten Spielen {b.punkteProSpiel ?? '–'} Punkte pro Spiel.
        </div>
      {/if}
      <div class="panel">
        <Linie titel="Punkte über die Saison" punkte={saison.spiele.map((s) => ({ t: Date.parse(s.datum), v: s.punkteSumme }))} min={0} zeitFormat={tagMonat} />
      </div>
      <div class="panel">
        <Linie titel="Überzahl Quote über die Saison" einheit="%" punkte={saison.spiele.map((s) => ({ t: Date.parse(s.datum), v: s.ueberzahlQuote }))} min={0} max={100} zeitFormat={tagMonat} />
        <Linie titel="Unterzahl überstanden über die Saison" einheit="%" farbe="var(--ok)" punkte={saison.spiele.map((s) => ({ t: Date.parse(s.datum), v: s.unterzahlQuote }))} min={0} max={100} zeitFormat={tagMonat} />
      </div>
      <h3>Tore pro Drittel</h3>
      <div class="panel tabelle-scroll">
        <table>
          <thead><tr><th>Drittel</th><th>Tore</th><th>Gegentore</th><th>Differenz</th></tr></thead>
          <tbody>
            {#each saison.drittel as d (d.drittel)}
              <tr>
                <td>{d.drittel === 4 ? 'Verlängerung' : `${d.drittel}. Drittel`}</td>
                <td class="zahl">{d.tore}</td>
                <td class="zahl">{d.gegentore}</td>
                <td class="zahl" class:plus={d.tore > d.gegentore} class:minus={d.tore < d.gegentore}>{d.tore - d.gegentore > 0 ? '+' : ''}{d.tore - d.gegentore}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <h3>Spiele</h3>
      <div class="liste">
        {#each [...saison.spiele].reverse() as s (s.id)}
          <button class="zeile spielzeile" onclick={() => berichtOeffnen(s.id)}>
            <span class="form"><span class="f-{s.ausgang}">{s.ausgang}</span></span>
            <span class="wachsen">{s.gegner}<span class="sehr-klein gedaempft"> · {datum(s.datum)}</span></span>
            <span class="zahl">{s.tore}:{s.gegentore}{s.verlaengerung ? ' n.V.' : ''}</span>
            <span class="sehr-klein gedaempft">{s.schuesse}:{s.schuesseGegen} Schüsse</span>
          </button>
        {/each}
      </div>
      <p class="sehr-klein gedaempft">Nur selbst erfasste Spiele. Punkte wie in der Meisterschaft: Sieg 3, nach Verlängerung 2 und 1.</p>
    {/if}
  {:else if tab === 'Vorbereitung'}
    {#if !vorbereitung}
      <p class="laedt">Lade Spielvorbereitung…</p>
    {:else}
      {@const v = vorbereitung}
      <div class="panel stapel">
        <h3>Nächstes Spiel{naechstes ? `: ${v.team ?? ''} gegen ${naechstes.gegner}` : ''}</h3>
        {#if naechstes}
          <div class="sehr-klein gedaempft">
            {naechstes.zeit ? new Date(naechstes.zeit).toLocaleString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Zeit offen'}{naechstes.ort ? `, ${naechstes.ort}` : ''}
          </div>
        {:else}
          <div class="sehr-klein gedaempft">Kein kommendes Spiel gefunden. Das Unihockey Modul liefert den Spielplan.</div>
        {/if}
        {#if v.form.length}
          <div class="zeile"><span class="sehr-klein gedaempft">Eigene Form</span><span class="form">{#each v.form as f, i (i)}<span class="f-{f}" title={AUSGANG_NAME[f]}>{f}</span>{/each}</span></div>
        {/if}
      </div>
      <div class="erfassen">
        <div class="panel stapel">
          <h3>Stärken</h3>
          {#each v.staerken as p (p.text)}
            <div class="punkt plus-rand"><div>{p.text}</div><div class="sehr-klein gedaempft">{p.detail}</div></div>
          {:else}
            <p class="leer">{v.spiele < 2 ? 'Ab zwei erfassten Spielen.' : 'Nichts Auffälliges.'}</p>
          {/each}
        </div>
        <div class="panel stapel">
          <h3>Schwächen</h3>
          {#each v.schwaechen as p (p.text)}
            <div class="punkt minus-rand"><div>{p.text}</div><div class="sehr-klein gedaempft">{p.detail}</div></div>
          {:else}
            <p class="leer">{v.spiele < 2 ? 'Ab zwei erfassten Spielen.' : 'Nichts Auffälliges.'}</p>
          {/each}
        </div>
      </div>
      <p class="sehr-klein gedaempft">Aus {v.spiele} erfassten Spielen der Saison {v.saison ?? ''}. Regeln: Drittel nach Tordifferenz, Spezialteams ab vier Situationen, Zonen ab zehn Abschlüssen.</p>
      {#if naechstes}
        <GegnerCheck teamId={naechstes.teamId} />
        <div class="panel stapel">
          <h3>Letzter Direktvergleich aus der Erfassung</h3>
          {#if v.letzter}
            <button class="zeile spielzeile" onclick={() => berichtOeffnen(v.letzter?.id ?? '')}>
              <span class="wachsen"><strong>{v.letzter.titel}</strong><br /><span class="sehr-klein gedaempft">{v.letzter.unter}</span></span>
              <span class="sehr-klein">Bericht</span>
            </button>
            {#each v.letzter.momente as m (m)}<div class="sehr-klein">{m}</div>{/each}
            {#if v.letzter.beste.length}
              <div class="sehr-klein gedaempft">Beste: {v.letzter.beste.map((b) => b.name).join(', ')}</div>
            {/if}
            {#if v.direkt.length > 1}
              <div class="sehr-klein gedaempft">Frühere: {v.direkt.slice(1).map((d) => `${datum(d.datum)} ${d.tore}:${d.gegentore}`).join(', ')}</div>
            {/if}
          {:else}
            <p class="leer">Noch kein erfasstes Spiel gegen {naechstes.gegner}.</p>
          {/if}
        </div>
      {/if}
    {/if}
  {:else if tab === 'Spieler'}
    <div class="zeile filter">{@render bereichWahl()}</div>
    {#if a?.bloecke.bloecke.length}
      <h3>Blöcke</h3>
      <div class="panel tabelle-scroll">
        {@render blockTabelle(a.bloecke.bloecke, 'Block')}
        <p class="sehr-klein gedaempft">
          Ein Abschluss zählt für den Block, aus dem die Mehrheit der Spieler auf dem Feld kommt. Schüsse und Tore als für:gegen, Plus Minus ohne eigene Überzahl und Penaltys.
          {#if a.bloecke.ohneFeld}{a.bloecke.ohneFeld} Abschlüsse ohne erfasste Spieler auf dem Feld sind nicht dabei.{/if}
        </p>
      </div>
      {#if a.bloecke.aufstellungen.length}
        <h3>Häufigste Aufstellungen</h3>
        <div class="panel tabelle-scroll">{@render blockTabelle(a.bloecke.aufstellungen, 'Spieler auf dem Feld')}</div>
      {/if}
      <h3>Spieler</h3>
    {/if}
    <div class="panel tabelle-scroll">
      {#if a?.spieler.length}
        <table>
          <thead><tr><th>Nr</th><th>Spieler</th><th>Sp</th><th>Tore</th><th>Ass</th><th>Pkt</th><th>+/−</th><th>Strafmin</th><th>Schüsse</th><th>Effizienz</th><th>Aufs Tor</th><th>Distanz</th></tr></thead>
          <tbody>
            {#each a.spieler as s (s.spieler.id)}
              <tr>
                <td>{s.spieler.nummer ?? ''}</td><td>{s.spieler.name}</td><td class="zahl">{s.spiele}</td><td class="zahl">{s.tore}</td><td class="zahl">{s.assists}</td>
                <td class="zahl"><strong>{s.punkte}</strong></td>
                <td class="zahl" class:plus={(s.plusMinus ?? 0) > 0} class:minus={(s.plusMinus ?? 0) < 0}>{s.plusMinus == null ? '' : s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}</td>
                <td class="zahl">{s.strafminuten || ''}</td><td class="zahl">{s.schuesse}</td><td class="zahl">{pct(s.effizienz)}</td><td class="zahl">{pct(s.praezision)}</td>
                <td class="zahl">{s.distanz != null ? `${s.distanz} m` : '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="leer">Noch keine Abschlüsse mit Spielern erfasst.</p>{/if}
    </div>
    <h3 style="margin-top:18px">Kader</h3>
    <p class="sehr-klein gedaempft">Nur Nummer und Vorname oder Kürzel erfassen, keine weiteren Angaben.</p>
    <div class="panel"><TabellenEditor tabelle="analyse_spieler" spalten={['nummer', 'name', 'position', 'block', 'aktiv']} sort="nummer" neuText="Spieler" bind:zeilen={spielerZeilen} /></div>
  {:else}
    <div class="panel">
      <ul class="liste">
        {#each u.spiele as s (s.id)}
          <li class="zeile spiel">
            <span class="sehr-klein gedaempft datum">{datum(s.datum, true)}</span>
            <span class="wachsen">gegen {s.gegner}</span>
            <span class="sehr-klein gedaempft">{s.schuesse.eigen}:{s.schuesse.gegner} Schüsse</span>
            <strong class="zahl">{s.resultat.eigen}:{s.resultat.gegner}</strong>
            <button class="leise klein" onclick={() => berichtOeffnen(s.id)}>Bericht</button>
            <button class="leise klein" onclick={() => spielOeffnen(s.id)}>Erfassen</button>
          </li>
        {:else}<li class="leer">Noch keine Spiele.</li>{/each}
      </ul>
    </div>
    <h3 style="margin-top:18px">Spiele verwalten</h3>
    <div class="panel"><TabellenEditor tabelle="analyse_spiele" spalten={['datum', 'gegner', 'team', 'ort', 'saison', 'drittel_min']} sort="-datum" neuText="Spiel" bind:zeilen={spielZeilen} /></div>
  {/if}
</ModulRahmen>

<style>
  .form {
    display: flex;
    gap: 4px;
    margin: 4px 0;
  }
  .form span {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: #0b0f14;
  }
  .f-S {
    background: var(--ok);
  }
  .f-U {
    background: #fbbf24;
  }
  .f-N {
    background: var(--ausfall);
  }
  .punkt {
    padding: 6px 0 6px 10px;
    border-left: 3px solid var(--rand);
  }
  .plus-rand {
    border-left-color: var(--ok);
  }
  .minus-rand {
    border-left-color: var(--ausfall);
  }
  .spielzeile {
    width: 100%;
    min-height: 0;
    text-align: left;
    gap: 10px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--rand);
    border-radius: 0;
    padding: 8px 0;
  }
  .bericht {
    border-left: 4px solid var(--rand);
  }
  .bericht.sieg {
    border-left-color: var(--ok);
  }
  .bericht.niederlage {
    border-left-color: var(--ausfall);
  }
  .bericht h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
  }
  .tor.gegen strong {
    color: var(--ausfall);
  }
  .tor .zeit {
    width: 44px;
  }
  .erfassen {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 800px) {
    .erfassen {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .stand {
    font-size: 2rem;
    font-weight: 700;
  }
  .wahl {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .wahl button,
  .chips button {
    background: var(--flaeche-2);
  }
  .wahl button.an,
  .chips button.an {
    background: #4cc9f026;
    border-color: var(--akzent);
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .minute {
    width: 72px;
  }
  .uhr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .uhr-zeit {
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--text-2);
  }
  .uhr-zeit.laeuft {
    color: var(--text);
  }
  .uhr-knoepfe {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .chips button.feld:not(.an) {
    border-color: var(--rand-stark, var(--akzent));
  }
  .strafe {
    gap: 6px;
    flex-wrap: wrap;
  }
  .strafe select {
    width: auto;
    flex: 1 1 120px;
  }
  .strafe button {
    min-width: 44px;
  }
  td.plus {
    color: var(--ok);
  }
  td.minus {
    color: var(--ausfall);
  }
  .ausgang {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .ausgang button {
    min-height: 48px;
    font-weight: 600;
  }
  .ausgang-tor:not(:disabled) {
    background: #34d39926;
    border-color: var(--ok);
  }
  .filter {
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .filter select {
    width: auto;
    flex: 1 1 160px;
    max-width: 260px;
  }
  .kennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }
  .gross {
    font-size: 1.6rem;
  }
  .legende {
    display: flex;
    gap: 14px;
    justify-content: center;
  }
  .l {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 5px;
  }
  .l.tor {
    background: var(--ok);
  }
  .l.gehalten {
    background: var(--akzent);
  }
  .l.daneben {
    border: 1.5px solid var(--text-2);
  }
  .l.geblockt {
    background: var(--warnung);
  }
  .spiel {
    gap: 10px;
    padding: 6px 0;
  }
  .datum {
    width: 90px;
    flex: none;
  }
</style>
