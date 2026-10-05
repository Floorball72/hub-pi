<script lang="ts">
  import Balken from '../komponenten/Balken.svelte';
  import Linie from '../komponenten/Linie.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { chf, datum, heuteIso, zahl } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Tankung { id: string; datum: string; km: number; liter: number; betrag: number | null; voll: boolean }
  interface Eintrag { id: string; datum: string; art: string; km: number | null; kosten: number | null; notiz: string | null }
  interface Fahrzeug {
    id: string;
    name: string;
    kennzeichen: string | null;
    modell: string | null;
    treibstoff: string | null;
    mfk_faellig: string | null;
    reifen_montiert: string | null;
    vignette_jahr: number | null;
    aktiv: boolean;
    kmJetzt: number | null;
    kmGeschaetzt: boolean;
    kmProJahr: number | null;
    verbrauch: { abschnitte: { datum: string; km: number; l100: number }[]; mittel: number | null; chf100: number | null };
    service: { datum: string | null; km: number | null; kmDatum: string | null; faellig: string | null; tage: number | null };
    reifen: { soll: string; wechseln: boolean; ab: string };
    vignette: { gueltig: boolean; kaufen: boolean; fuer: number };
    mfkTage: number | null;
    kosten: { monat: string; treibstoff: number; unterhalt: number }[];
    kosten12: number;
    chfProKm: number | null;
    tankungen: Tankung[];
    eintraege: Eintrag[];
  }

  const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const ARTEN = ['Service', 'Reparatur', 'MFK', 'Reifenwechsel', 'Pflege', 'Andere'];

  let tab = $state('Übersicht');
  let liste = $state<Fahrzeug[] | null>(null);
  let auswahl = $state('');
  let fahrzeugZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let tankZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let eintragZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);

  async function laden() {
    const r = await api.get<{ fahrzeuge: Fahrzeug[] }>('/api/m/fahrzeug/uebersicht');
    liste = r.fahrzeuge;
    if (!liste.some((f) => f.id === auswahl)) auswahl = (liste.find((f) => f.aktiv) ?? liste[0])?.id ?? '';
  }
  $effect(() => {
    void tab;
    void JSON.stringify(fahrzeugZeilen);
    void JSON.stringify(tankZeilen);
    void JSON.stringify(eintragZeilen);
    laden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const f = $derived(liste?.find((x) => x.id === auswahl) ?? null);
  const einheit = $derived(f?.treibstoff === 'Elektro' ? 'kWh' : 'l');

  function tageText(t: number | null): string {
    if (t == null) return '';
    if (t < 0) return `seit ${-t} ${-t === 1 ? 'Tag' : 'Tagen'} fällig`;
    if (t === 0) return 'heute';
    if (t === 1) return 'morgen';
    return `in ${t} Tagen`;
  }
  function serviceText(x: Fahrzeug): string {
    const s = x.service;
    if (!s.faellig) return 'Kein Intervall oder letzter Service erfasst';
    const teile = [];
    if (s.km != null) teile.push(`bei ${zahl(s.km)} km${s.kmDatum ? `, geschätzt ${datum(s.kmDatum, true)}` : ''}`);
    if (s.datum) teile.push(`spätestens ${datum(s.datum, true)}`);
    return teile.join(' oder ');
  }

  // ---------- Tanken ----------
  let tDatum = $state(heuteIso());
  let tKm = $state('');
  let tLiter = $state('');
  let tBetrag = $state('');
  let tVoll = $state(true);
  const nr = (s: string) => Number(s.replace(',', '.').replace(/['’\s]/g, ''));
  const literPreis = $derived(tLiter && tBetrag && nr(tLiter) > 0 ? nr(tBetrag) / nr(tLiter) : null);
  async function tanken(e: SubmitEvent) {
    e.preventDefault();
    if (!f) return;
    try {
      await api.post('/api/m/fahrzeug/tanken', {
        fahrzeug_id: f.id,
        datum: tDatum,
        km: nr(tKm),
        liter: nr(tLiter),
        betrag: tBetrag ? nr(tBetrag) : null,
        voll: tVoll,
      });
      melden('Tankung erfasst', 'ok');
      tKm = '';
      tLiter = '';
      tBetrag = '';
      tVoll = true;
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }

  // ---------- Service und Einträge ----------
  let eArt = $state('Service');
  let eDatum = $state(heuteIso());
  let eKm = $state('');
  let eKosten = $state('');
  let eNotiz = $state('');
  async function eintragen(e: SubmitEvent) {
    e.preventDefault();
    if (!f) return;
    try {
      await api.post(`/api/m/fahrzeug/fahrzeug/${f.id}/eintrag`, {
        art: eArt,
        datum: eDatum,
        km: eKm ? nr(eKm) : null,
        kosten: eKosten ? nr(eKosten) : null,
        notiz: eNotiz,
      });
      melden(`${eArt} eingetragen`, 'ok');
      eKm = '';
      eKosten = '';
      eNotiz = '';
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }
  async function reifenGewechselt(x: Fahrzeug) {
    if (!(await bestaetigen('Reifen gewechselt?', `Der Hub trägt einen Reifenwechsel ein und merkt sich, dass jetzt ${x.reifen.soll}reifen montiert sind.`, 'Eintragen'))) return;
    try {
      await api.post(`/api/m/fahrzeug/fahrzeug/${x.id}/eintrag`, { art: 'Reifenwechsel', reifen: x.reifen.soll, notiz: `${x.reifen.soll}reifen montiert` });
      melden(`${x.reifen.soll}reifen eingetragen`, 'ok');
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }
  async function vignetteGekauft(x: Fahrzeug) {
    try {
      await api.post(`/api/m/fahrzeug/fahrzeug/${x.id}/vignette`, { jahr: x.vignette.fuer });
      melden(`Vignette ${x.vignette.fuer} eingetragen`, 'ok');
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }
</script>

<ModulRahmen modulId="fahrzeug" tabs={['Übersicht', 'Tanken', 'Service']} bind:tab>
  {#if !liste}
    <div class="laedt">Lädt …</div>
  {:else}
    <div class="stapel">
      {#if liste.length > 1}
        <div class="auswahl" role="group" aria-label="Fahrzeug wählen">
          {#each liste as x (x.id)}
            <button class="leise klein" class:an={x.id === auswahl} onclick={() => (auswahl = x.id)}>{x.name}</button>
          {/each}
        </div>
      {/if}

      {#if !f}
        <div class="panel leer">Noch kein Fahrzeug erfasst. Unten ein Fahrzeug anlegen.</div>
      {:else if tab === 'Übersicht'}
        <div class="kennzahlen">
          <div class="panel"><div class="sehr-klein gedaempft">Verbrauch</div><div class="zahl gross">{f.verbrauch.mittel != null ? `${zahl(f.verbrauch.mittel, 1)} ${einheit}` : 'offen'}</div><div class="sehr-klein gedaempft">pro 100 km{#if f.verbrauch.chf100 != null}{' · '}{chf(f.verbrauch.chf100)}{/if}</div></div>
          <div class="panel"><div class="sehr-klein gedaempft">Kilometerstand</div><div class="zahl gross">{f.kmJetzt != null ? zahl(f.kmJetzt) : 'offen'}</div><div class="sehr-klein gedaempft">{f.kmGeschaetzt ? 'geschätzt' : 'zuletzt erfasst'}{#if f.kmProJahr}{' · '}{zahl(f.kmProJahr)} km pro Jahr{/if}</div></div>
          <div class="panel"><div class="sehr-klein gedaempft">Kosten 12 Monate</div><div class="zahl gross">{chf(f.kosten12)}</div><div class="sehr-klein gedaempft">{f.chfProKm != null ? `${chf(f.chfProKm)} pro km ohne Fixkosten` : 'Treibstoff und Unterhalt'}</div></div>
        </div>

        <div class="panel">
          <h3>Termine</h3>
          <ul class="liste">
            <li class="eintrag" class:dringend={(f.mfkTage ?? 99) <= 14}>
              <div class="info"><span class="titel">MFK</span><span class="sehr-klein gedaempft">{f.mfk_faellig ? datum(f.mfk_faellig, true) : 'Datum aus dem Aufgebot in den Fahrzeugdaten eintragen'}</span></div>
              {#if f.mfkTage != null}<span class="sehr-klein">{tageText(f.mfkTage)}</span>{/if}
            </li>
            <li class="eintrag" class:dringend={(f.service.tage ?? 99) <= 7}>
              <div class="info"><span class="titel">Service</span><span class="sehr-klein gedaempft">{serviceText(f)}</span></div>
              {#if f.service.tage != null}<span class="sehr-klein">{tageText(f.service.tage)}</span>{/if}
            </li>
            <li class="eintrag" class:dringend={f.reifen.wechseln}>
              <div class="info">
                <span class="titel">Reifen</span>
                <span class="sehr-klein gedaempft">
                  {f.reifen_montiert ? `${f.reifen_montiert}reifen montiert` : 'Montierte Reifen nicht erfasst'}{' · '}{f.reifen.wechseln ? `jetzt ${f.reifen.soll}reifen` : f.reifen_montiert === 'Ganzjahr' ? 'kein Wechsel nötig' : `Wechsel ab ${datum(f.reifen.ab, true)}`}
                </span>
              </div>
              {#if f.reifen_montiert !== 'Ganzjahr' && (f.reifen.wechseln || !f.reifen_montiert)}
                <button class="leise klein" onclick={() => reifenGewechselt(f)}>{f.reifen.soll}reifen montiert</button>
              {/if}
            </li>
            <li class="eintrag" class:dringend={!f.vignette.gueltig}>
              <div class="info"><span class="titel">Vignette</span><span class="sehr-klein gedaempft">{f.vignette_jahr ? `Vignette ${f.vignette_jahr}` : 'nicht erfasst'}{' · '}{f.vignette.gueltig ? (f.vignette.kaufen ? `${f.vignette.fuer} kaufen` : 'gültig') : 'nicht gültig'}</span></div>
              {#if f.vignette.kaufen}<button class="leise klein" onclick={() => vignetteGekauft(f)}>{f.vignette.fuer} gekauft</button>{/if}
            </li>
          </ul>
        </div>

        <div class="raster-2">
          <div class="panel">
            <h3>Verbrauch je Tankfüllung</h3>
            {#if f.verbrauch.abschnitte.length < 2}
              <div class="leer">Ab zwei Volltankungen erscheint hier der Verbrauch.</div>
            {:else}
              <Linie punkte={f.verbrauch.abschnitte.map((a) => ({ t: new Date(`${a.datum}T12:00:00`).getTime(), v: a.l100 }))} einheit="{einheit}/100 km" hoehe={150} zeitFormat={(t) => new Date(t).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })} />
            {/if}
            <p class="sehr-klein gedaempft">Gerechnet von Volltankung zu Volltankung. Teiltankungen zählen mit.</p>
          </div>
          <div class="panel">
            <h3>Kosten pro Monat</h3>
            <Balken werte={f.kosten.map((k) => Math.round(k.treibstoff + k.unterhalt))} beschriftung={f.kosten.map((k) => MONATE[Number(k.monat.slice(5, 7)) - 1])} einheit="CHF" hoehe={150} />
            <p class="sehr-klein gedaempft">Treibstoff, Service und Reparaturen. Versicherung und Steuer laufen über Finanzen.</p>
          </div>
        </div>
      {:else if tab === 'Tanken'}
        <form class="panel erfassen" onsubmit={tanken}>
          <label>Datum<input type="date" bind:value={tDatum} max={heuteIso()} /></label>
          <label>Kilometerstand<input bind:value={tKm} inputmode="numeric" placeholder={f.tankungen[0] ? String(f.tankungen[0].km) : 'km'} /></label>
          <label>Menge in {einheit}<input bind:value={tLiter} inputmode="decimal" placeholder="45.2" /></label>
          <label>Betrag CHF<input bind:value={tBetrag} inputmode="decimal" placeholder="optional" /></label>
          <label class="haken-zeile"><input type="checkbox" bind:checked={tVoll} /> vollgetankt</label>
          <button class="primaer" disabled={!tKm || !tLiter}>Erfassen</button>
          {#if literPreis}<span class="sehr-klein gedaempft">{chf(literPreis)} pro {einheit === 'l' ? 'Liter' : 'kWh'}</span>{/if}
        </form>
        <div class="panel">
          {#if !f.tankungen.length}<div class="leer">Noch keine Tankungen.</div>{/if}
          <ul class="liste">
            {#each f.tankungen as t (t.id)}
              {@const a = f.verbrauch.abschnitte.find((x) => x.datum === t.datum)}
              <li class="eintrag">
                <span class="datum sehr-klein gedaempft">{datum(t.datum)}</span>
                <div class="info"><span>{zahl(t.liter, 2)} {einheit}{#if !t.voll}<span class="marke">teilweise</span>{/if}</span><span class="sehr-klein gedaempft">{zahl(t.km)} km{#if a}{' · '}{zahl(a.l100, 1)} {einheit}/100 km auf {zahl(a.km)} km{/if}</span></div>
                {#if t.betrag != null}<span class="zahl">{chf(t.betrag)}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
        <details class="panel">
          <summary>Tankungen bearbeiten</summary>
          <TabellenEditor tabelle="tankungen" spalten={['datum', 'km', 'liter', 'betrag', 'voll']} sort="-datum" neuText="Tankung" bind:zeilen={tankZeilen} />
        </details>
      {:else}
        <form class="panel erfassen" onsubmit={eintragen}>
          <label>Art<select bind:value={eArt}>{#each ARTEN as a (a)}<option>{a}</option>{/each}</select></label>
          <label>Datum<input type="date" bind:value={eDatum} /></label>
          <label>Kilometerstand<input bind:value={eKm} inputmode="numeric" placeholder={f.kmJetzt ? `etwa ${f.kmJetzt}` : 'km'} /></label>
          <label>Kosten CHF<input bind:value={eKosten} inputmode="decimal" placeholder="optional" /></label>
          <label class="wachsen">Was wurde gemacht<input bind:value={eNotiz} maxlength="500" placeholder="z.B. Ölwechsel, Bremsen vorne" /></label>
          <button class="primaer">Eintragen</button>
        </form>
        {#if eArt === 'Service'}<p class="sehr-klein gedaempft hinweis">Ein Service mit Kilometerstand setzt das Service Intervall neu.</p>{/if}
        <div class="panel">
          {#if !f.eintraege.length}<div class="leer">Noch keine Einträge.</div>{/if}
          <ul class="liste">
            {#each f.eintraege as e (e.id)}
              <li class="eintrag">
                <span class="datum sehr-klein gedaempft">{datum(e.datum, true)}</span>
                <div class="info"><span class="titel">{e.art}</span><span class="sehr-klein gedaempft">{e.notiz ?? ''}{#if e.km != null}{e.notiz ? ' · ' : ''}{zahl(e.km)} km{/if}</span></div>
                {#if e.kosten != null}<span class="zahl">{chf(e.kosten)}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
        <details class="panel">
          <summary>Einträge bearbeiten</summary>
          <TabellenEditor tabelle="fahrzeug_eintraege" spalten={['datum', 'art', 'km', 'kosten', 'notiz']} sort="-datum" neuText="Eintrag" bind:zeilen={eintragZeilen} />
        </details>
      {/if}

      <details class="panel">
        <summary>Fahrzeuge erfassen und bearbeiten</summary>
        <p class="sehr-klein gedaempft">MFK Datum steht auf dem Aufgebot des Strassenverkehrsamts. Service Intervall nach Serviceheft, der Hub nimmt, was zuerst kommt.</p>
        <TabellenEditor tabelle="fahrzeuge" spalten={['name', 'modell', 'treibstoff', 'mfk_faellig', 'service_monate', 'service_km', 'letzter_service_datum', 'letzter_service_km', 'reifen_montiert', 'vignette_jahr', 'aktiv']} sort="name" neuText="Fahrzeug" bind:zeilen={fahrzeugZeilen} />
      </details>
    </div>
  {/if}
</ModulRahmen>

<style>
  h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .kennzahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .gross { font-size: 1.45rem; font-weight: 600; }
  .auswahl { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .auswahl .an { background: var(--akzent); color: var(--bg); }
  .liste { list-style: none; padding: 0; margin: 0; }
  .eintrag { display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0; border-bottom: 1px solid var(--rand); }
  .eintrag:last-child { border-bottom: 0; }
  .eintrag .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .eintrag.dringend .titel { color: var(--warnung); }
  .datum { min-width: 4.5rem; }
  .marke { margin-left: 0.4rem; font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: var(--flaeche-3); color: var(--text-3); }
  .erfassen { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; }
  .erfassen label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; color: var(--text-3); }
  .erfassen label input, .erfassen label select { width: 8.5rem; }
  .erfassen .wachsen { flex: 1; min-width: 12rem; }
  .erfassen .wachsen input { width: 100%; }
  .erfassen .haken-zeile { flex-direction: row; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: var(--text-2); padding-bottom: 0.5rem; }
  .erfassen .haken-zeile input { width: auto; }
  .hinweis { margin: -0.4rem 0 0; }
  summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
  details[open] summary { margin-bottom: 0.5rem; }
</style>
