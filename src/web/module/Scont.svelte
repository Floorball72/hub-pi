<script lang="ts">
  import Icon from '../komponenten/Icon.svelte';
  import Linie from '../komponenten/Linie.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import Berichte from './scont/Berichte.svelte';
  import ZeitErfassung from './scont/ZeitErfassung.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { chf, datum, datumZeit, relativ } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren, ort, parameter } from '../lib/router.svelte.ts';

  interface Zustand {
    seite: { id: string; name: string; url: string; aktiv: boolean; oeffentlich: boolean };
    letzte: { erstellt: string; ms: number | null; status: number | null; fehler: string | null } | null;
    online: boolean | null;
    verfuegbarkeit: { tag: number | null; woche: number | null; monat: number | null };
    sslTage: number | null;
    sslFehler: string | null;
    performance: number | null;
    note: string | null;
    vorfallOffen: boolean;
  }
  interface Uebersicht {
    seiten: Zustand[];
    domainsBald: { id: string; name: string; ablauf: string }[];
    kosten: { proJahr: number; proMonat: number; weiterverrechnet: number; anzahl: number };
    kunden: number;
  }
  interface Detail {
    seite: { id: string; name: string; url: string };
    pruefungen: { erstellt: string; ok: boolean; ms: number | null; status: number | null; fehler: string | null }[];
    vorfaelle: { id: string; start: string; ende: string | null; grund: string | null }[];
    ssl: { gueltig_bis: string | null; aussteller: string | null; fehler: string | null } | null;
    pagespeed: { erstellt: string; performance: number | null; barrierefreiheit: number | null; best_practices: number | null; seo: number | null; lcp_ms: number | null; cls: number | null; tbt_ms: number | null }[];
    qualitaet: {
      erstellt: string;
      note: string;
      punkte: number;
      ergebnis: {
        header: { name: string; vorhanden: boolean; wert?: string; empfehlung: string }[];
        cookie: { gefunden: boolean; loesung: string | null };
        links: { geprueft: number; defekt: { url: string; status: number | string }[] };
        vorschlaege: string[];
      };
    } | null;
    verfuegbarkeit: { tag: number | null; woche: number | null; monat: number | null };
  }

  let tab = $state('Übersicht');
  let u = $state<Uebersicht | null>(null);
  let detail = $state<Detail | null>(null);
  let laeuft = $state('');
  const seiteId = $derived((void ort.suche, parameter('seite')));

  async function laden() {
    u = await api.get<Uebersicht>('/api/m/scont/uebersicht');
  }
  let detailFehler = $state('');
  async function detailLaden(id: string) {
    detail = null;
    detailFehler = '';
    try {
      detail = await api.get<Detail>(`/api/m/scont/seite/${id}`);
    } catch (e) {
      detailFehler = fehlerText(e);
    }
  }

  $effect(() => {
    laden();
    const t = setInterval(laden, 60000);
    return () => clearInterval(t);
  });
  $effect(() => {
    if (seiteId) detailLaden(seiteId);
    else detail = null;
  });

  async function aktion(art: 'pruefen' | 'qualitaet' | 'pagespeed') {
    if (!detail) return;
    const texte = {
      pruefen: ['Seite jetzt prüfen?', 'Ein einzelner Abruf der Seite.'],
      qualitaet: ['Qualitätscheck starten?', 'Header, Cookie Hinweis und bis zu 40 Links werden schonend geprüft (ein Abruf pro Sekunde).'],
      pagespeed: ['PageSpeed messen?', 'Google misst die Seite. Ohne API Schlüssel ist das Kontingent klein.'],
    }[art];
    if (!(await bestaetigen(texte[0], texte[1], 'Starten'))) return;
    laeuft = art;
    try {
      await api.post(`/api/m/scont/seite/${detail.seite.id}/${art}`, { bestaetigt: true });
      melden('Fertig');
      await detailLaden(detail.seite.id);
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      laeuft = '';
    }
  }

  function prozent(v: number | null) {
    return v === null ? '–' : `${v.toLocaleString('de-CH', { maximumFractionDigits: 2 })} %`;
  }
  function verfuegbarkeitsKlasse(v: number | null) {
    return v === null ? '' : v >= 99.5 ? 'ok' : v >= 98 ? 'warnung' : 'ausfall';
  }
  function noteKlasse(n: string | null) {
    return !n ? '' : n === 'A' || n === 'B' ? 'ok' : n === 'C' ? 'warnung' : 'ausfall';
  }
</script>

<ModulRahmen modulId="scont" tabs={['Übersicht', 'Zeit', 'Berichte', 'Seiten', 'Kunden', 'Domains', 'Kosten']} bind:tab>
  {#if tab === 'Übersicht'}
    {#if detail}
      <div class="zeile-zwischen">
        <button class="leise" onclick={() => navigieren('/modul/scont')}><Icon name="zurueck" groesse={16} />Alle Seiten</button>
        <div class="zeile">
          <button class="klein" disabled={!!laeuft} onclick={() => aktion('pruefen')}>Jetzt prüfen</button>
          <button class="klein" disabled={!!laeuft} onclick={() => aktion('qualitaet')}>Qualitätscheck</button>
          <button class="klein" disabled={!!laeuft} onclick={() => aktion('pagespeed')}>PageSpeed</button>
        </div>
      </div>
      <h2 style="margin-top:10px">{detail.seite.name}</h2>
      <a class="klein" href={detail.seite.url} target="_blank" rel="noopener noreferrer">{detail.seite.url}</a>

      <div class="raster werte">
        <div class="panel"><h3>Verfügbarkeit 24 h</h3><div class="zahl gross {verfuegbarkeitsKlasse(detail.verfuegbarkeit.tag)}">{prozent(detail.verfuegbarkeit.tag)}</div></div>
        <div class="panel"><h3>7 Tage</h3><div class="zahl gross {verfuegbarkeitsKlasse(detail.verfuegbarkeit.woche)}">{prozent(detail.verfuegbarkeit.woche)}</div></div>
        <div class="panel"><h3>30 Tage</h3><div class="zahl gross {verfuegbarkeitsKlasse(detail.verfuegbarkeit.monat)}">{prozent(detail.verfuegbarkeit.monat)}</div></div>
        <div class="panel">
          <h3>SSL</h3>
          {#if detail.ssl?.gueltig_bis}
            <div class="zahl gross">{Math.floor((new Date(detail.ssl.gueltig_bis).getTime() - Date.now()) / 86400000)}<span class="einheit">Tage</span></div>
            <div class="sehr-klein gedaempft">{detail.ssl.aussteller ?? ''}{detail.ssl.fehler ? ` · ${detail.ssl.fehler}` : ''}</div>
          {:else}<div class="gedaempft">{detail.ssl?.fehler ?? 'noch nicht geprüft'}</div>{/if}
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <Linie
          titel="Antwortzeit der letzten 48 Stunden (rote Striche: Ausfall)"
          einheit="ms"
          lueckenMs={45 * 60000}
          punkte={detail.pruefungen.map((p) => ({ t: new Date(p.erstellt).getTime(), v: p.ok ? p.ms : null, markierung: !p.ok }))}
        />
      </div>

      <div class="raster-2" style="margin-top:12px">
        <section class="panel">
          <h2>PageSpeed (mobil)</h2>
          {#if detail.pagespeed.length}
            {@const p = detail.pagespeed[0]}
            <div class="raster-4">
              {#each [['Performance', p.performance], ['Barrierefreiheit', p.barrierefreiheit], ['Best Practices', p.best_practices], ['SEO', p.seo]] as [n, w] (n)}
                <div class="kreis {(w as number) >= 90 ? 'ok' : (w as number) >= 50 ? 'warnung' : 'ausfall'}"><span class="zahl">{w ?? '–'}</span><small>{n}</small></div>
              {/each}
            </div>
            <div class="klein gedaempft">LCP {p.lcp_ms ?? '–'} ms · CLS {p.cls ?? '–'} · TBT {p.tbt_ms ?? '–'} ms · {relativ(p.erstellt)}</div>
            <Linie titel="Performance Verlauf" hoehe={110} min={0} max={100} zeitFormat={(t) => new Date(t).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })} punkte={[...detail.pagespeed].reverse().map((x) => ({ t: new Date(x.erstellt).getTime(), v: x.performance }))} />
          {:else}<p class="leer">Noch keine Messung. Läuft täglich um 04:10.</p>{/if}
        </section>

        <section class="panel">
          <h2>Qualitätscheck</h2>
          {#if detail.qualitaet}
            {@const q = detail.qualitaet}
            <div class="zeile"><span class="note {noteKlasse(q.note)}">{q.note}</span><span class="gedaempft klein">{q.punkte} von 100 Punkten · {relativ(q.erstellt)}</span></div>
            <ul class="liste klein">
              {#each q.ergebnis.header as h (h.name)}
                <li class="zeile-zwischen"><span class="zeile"><span class="punkt {h.vorhanden ? 'ok' : 'warnung'}"></span><span class="mono">{h.name}</span></span><span class="gedaempft">{h.vorhanden ? 'gesetzt' : 'fehlt'}</span></li>
              {/each}
              <li class="zeile-zwischen"><span class="zeile"><span class="punkt {q.ergebnis.cookie.gefunden ? 'ok' : 'warnung'}"></span>Cookie Hinweis</span><span class="gedaempft">{q.ergebnis.cookie.gefunden ? (q.ergebnis.cookie.loesung ?? 'erkannt') : 'nicht erkannt'}</span></li>
              <li class="zeile-zwischen"><span class="zeile"><span class="punkt {q.ergebnis.links.defekt.length ? 'ausfall' : 'ok'}"></span>Links</span><span class="gedaempft">{q.ergebnis.links.defekt.length} defekt von {q.ergebnis.links.geprueft}</span></li>
            </ul>
            {#if q.ergebnis.links.defekt.length}
              <ul class="sehr-klein">{#each q.ergebnis.links.defekt as l (l.url)}<li><span class="mono">{l.url}</span> ({l.status})</li>{/each}</ul>
            {/if}
            {#if q.ergebnis.vorschlaege.length}
              <h3 style="margin-top:12px">Vorschläge</h3>
              <ul class="klein">{#each q.ergebnis.vorschlaege as v (v)}<li>{v}</li>{/each}</ul>
            {/if}
          {:else}<p class="leer">Noch kein Check. Läuft wöchentlich.</p>{/if}
        </section>
      </div>

      <section class="panel" style="margin-top:12px">
        <h2>Ausfälle</h2>
        {#if !detail.vorfaelle.length}<p class="leer">Keine Ausfälle erfasst.</p>{:else}
          <ul class="liste">
            {#each detail.vorfaelle as v (v.id)}
              <li class="zeile-zwischen">
                <span class="zeile"><span class="punkt {v.ende ? 'warnung' : 'ausfall'}"></span>{datumZeit(v.start)}{v.ende ? ` bis ${datumZeit(v.ende)}` : ' (dauert an)'}</span>
                <span class="gedaempft klein">{v.grund ?? ''}{v.ende ? ` · ${Math.round((new Date(v.ende).getTime() - new Date(v.start).getTime()) / 60000)} min` : ''}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else if seiteId && detailFehler}
      <div class="hinweis ausfall">{detailFehler}. <a href="/modul/scont">Zur Übersicht</a></div>
    {:else if seiteId}
      <div class="laedt" style="height:300px"></div>
    {:else if u}
      <div class="raster werte">
        <div class="panel"><h3>Seiten online</h3><div class="zahl gross">{u.seiten.filter((s) => s.seite.aktiv && s.online !== false).length}<span class="einheit">/ {u.seiten.filter((s) => s.seite.aktiv).length}</span></div></div>
        <div class="panel"><h3>Aktive Kunden</h3><div class="zahl gross">{u.kunden}</div></div>
        <div class="panel"><h3>Kosten pro Monat</h3><div class="zahl gross">{chf(u.kosten.proMonat)}</div><div class="sehr-klein gedaempft">{chf(u.kosten.proJahr)} pro Jahr · {chf(u.kosten.weiterverrechnet)} weiterverrechnet</div></div>
        <div class="panel">
          <h3>Domains bald fällig</h3>
          {#if u.domainsBald.length}
            {#each u.domainsBald.slice(0, 3) as d (d.id)}<div class="zeile-zwischen klein"><span>{d.name}</span><span class="marke warnung">{datum(d.ablauf, true)}</span></div>{/each}
          {:else}<div class="gedaempft">keine in 60 Tagen</div>{/if}
        </div>
      </div>

      <div class="seiten">
        {#each u.seiten as z (z.seite.id)}
          <a class="seite panel {z.online === false ? 'unten' : ''}" href="/modul/scont?seite={z.seite.id}">
            <div class="zeile-zwischen">
              <strong class="zeile"><span class="punkt {z.online === false ? 'ausfall' : z.online ? 'ok' : ''}"></span>{z.seite.name}</strong>
              {#if !z.seite.aktiv}<span class="marke">pausiert</span>{:else if z.online === false}<span class="marke ausfall">Ausfall</span>{/if}
            </div>
            <div class="sehr-klein gedaempft url">{z.seite.url}</div>
            <div class="metriken">
              <div><span class="zahl">{z.letzte?.ms ?? '–'}</span><small>ms</small></div>
              <div><span class="zahl {verfuegbarkeitsKlasse(z.verfuegbarkeit.monat)}">{z.verfuegbarkeit.monat === null ? '–' : z.verfuegbarkeit.monat.toFixed(1)}</span><small>% 30 T</small></div>
              <div><span class="zahl {z.sslTage !== null && z.sslTage < 14 ? 'warnung' : ''}">{z.sslTage ?? '–'}</span><small>T SSL</small></div>
              <div><span class="zahl">{z.performance ?? '–'}</span><small>Speed</small></div>
              <div><span class="zahl {noteKlasse(z.note)}">{z.note ?? '–'}</span><small>Note</small></div>
            </div>
            <div class="sehr-klein gedaempft">{z.letzte ? `geprüft ${relativ(z.letzte.erstellt)}` : 'noch nicht geprüft'}</div>
          </a>
        {:else}
          <p class="leer">Noch keine Seiten. Im Tab «Seiten» hinzufügen.</p>
        {/each}
      </div>
    {:else}
      <div class="laedt" style="height:200px"></div>
    {/if}
  {:else if tab === 'Zeit'}
    <ZeitErfassung />
  {:else if tab === 'Berichte'}
    <Berichte />
  {:else if tab === 'Seiten'}
    <div class="panel"><TabellenEditor tabelle="seiten" spalten={['name', 'url', 'kunde_id', 'aktiv', 'intervall_min', 'oeffentlich']} neuText="Seite" onauswahl={(z) => { tab = 'Übersicht'; navigieren(`/modul/scont?seite=${z.id}`); }} /></div>
  {:else if tab === 'Kunden'}
    <div class="panel"><TabellenEditor tabelle="kunden" spalten={['name', 'status', 'stundensatz']} neuText="Kunde" /></div>
  {:else if tab === 'Domains'}
    <div class="panel"><TabellenEditor tabelle="domains" sort="ablauf" spalten={['name', 'kunde_id', 'ablauf', 'kosten_jahr', 'registrar']} neuText="Domain" /></div>
  {:else if tab === 'Kosten'}
    <div class="panel"><TabellenEditor tabelle="kosten" sort="naechste_zahlung" spalten={['bezeichnung', 'art', 'betrag', 'intervall', 'naechste_zahlung', 'kunde_id']} neuText="Kosten" /></div>
  {/if}
</ModulRahmen>

<style>
  .werte {
    margin: 12px 0;
  }
  .gross {
    font-size: 1.9rem;
  }
  .einheit {
    font-size: 0.9rem;
    color: var(--text-2);
    margin-left: 4px;
  }
  .ok {
    color: var(--ok);
  }
  .warnung {
    color: var(--warnung);
  }
  .ausfall {
    color: var(--ausfall);
  }
  .seiten {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  }
  .seite {
    color: inherit;
    display: grid;
    gap: 6px;
  }
  .seite:hover {
    text-decoration: none;
    border-color: var(--rand-hell);
  }
  .seite.unten {
    border-color: #f8717166;
  }
  .url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .metriken {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    margin: 6px 0;
  }
  .metriken div {
    display: grid;
    text-align: center;
  }
  .metriken .zahl {
    font-size: 1.15rem;
  }
  .metriken small {
    color: var(--text-3);
    font-size: 0.68rem;
  }
  .raster-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }
  .kreis {
    display: grid;
    justify-items: center;
    padding: 8px 0;
    border-radius: 12px;
    background: var(--flaeche-3);
    border: 1px solid var(--rand);
  }
  .kreis .zahl {
    font-size: 1.5rem;
  }
  .kreis small {
    font-size: 0.65rem;
    color: var(--text-2);
    text-align: center;
  }
  .kreis.ok .zahl {
    color: var(--ok);
  }
  .kreis.warnung .zahl {
    color: var(--warnung);
  }
  .kreis.ausfall .zahl {
    color: var(--ausfall);
  }
  .note {
    font-family: var(--schrift-zahl);
    font-size: 2rem;
    font-weight: 700;
    width: 52px;
    height: 52px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: var(--flaeche-3);
    border: 1px solid var(--rand-hell);
  }
</style>
