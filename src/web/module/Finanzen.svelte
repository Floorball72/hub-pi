<script lang="ts">
  import Balken from '../komponenten/Balken.svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { chf, datum } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Frist { vertragsende: string; kuendigenBis: string | null; tage: number | null; verpasst: boolean }
  interface Abo {
    id: string;
    name: string;
    kategorie: string | null;
    betrag: number;
    intervall: string;
    naechste: string | null;
    monat: number;
    gekuendigt: boolean;
    aktiv: boolean;
    frist: Frist | null;
  }
  interface Rechnung { id: string; titel: string; kategorie: string | null; betrag: number; faellig: string; bezahlt: boolean; bezahlt_am: string | null; tage?: number }
  interface Uebersicht {
    heute: string;
    summen: { monat: number; jahr: number; geschaeftMonat: number | null; offen: number; kommend30: number };
    kategorien: { name: string; betrag: number }[];
    abos: Abo[];
    fristen: ({ id: string; name: string } & Frist)[];
    rechnungen: Rechnung[];
    bezahlt: Rechnung[];
    kommend: { datum: string; titel: string; betrag: number; art: 'abo' | 'rechnung' }[];
    verlauf: { monat: string; summe: number }[];
  }

  const INTERVALL: Record<string, string> = { monatlich: 'pro Monat', vierteljaehrlich: 'pro Quartal', halbjaehrlich: 'pro Halbjahr', jaehrlich: 'pro Jahr', einmalig: 'einmalig' };
  const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  let tab = $state('Übersicht');
  let u = $state<Uebersicht | null>(null);
  let aboZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let rechnungZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);

  async function laden() {
    u = await api.get('/api/m/finanzen/uebersicht');
  }
  $effect(() => {
    void tab;
    void JSON.stringify(aboZeilen);
    void JSON.stringify(rechnungZeilen);
    laden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const maxKategorie = $derived(Math.max(1, ...(u?.kategorien ?? []).map((k) => k.betrag)));
  const laufend = $derived((u?.abos ?? []).filter((a) => a.aktiv).sort((a, b) => b.monat - a.monat));
  const beendet = $derived((u?.abos ?? []).filter((a) => !a.aktiv));

  function fristText(f: Frist | null, gekuendigt: boolean): string {
    if (!f) return '';
    if (gekuendigt) return `gekündigt, endet ${datum(f.vertragsende, true)}`;
    if (!f.kuendigenBis) return `endet ${datum(f.vertragsende, true)}`;
    const wann = f.tage === 0 ? 'heute' : f.tage === 1 ? 'morgen' : `in ${f.tage} Tagen`;
    return `kündbar bis ${datum(f.kuendigenBis, true)} (${wann})${f.verpasst ? ', die Frist zum letzten Vertragsende ist verpasst' : ''}`;
  }
  const dringend = (f: Frist | null) => f?.tage != null && f.tage <= 14;

  async function alsGekuendigt(a: Abo, gekuendigt = true) {
    const text = gekuendigt
      ? `Der Hub merkt sich, dass «${a.name}» gekündigt ist${a.frist ? ` und auf ${datum(a.frist.vertragsende, true)} ausläuft` : ''}. Gekündigt wird nichts automatisch.`
      : `«${a.name}» wird wieder als laufend geführt.`;
    if (!(await bestaetigen(gekuendigt ? 'Als gekündigt markieren?' : 'Kündigung zurücknehmen?', text, gekuendigt ? 'Markieren' : 'Zurücknehmen'))) return;
    try {
      await api.post(`/api/m/finanzen/abo/${a.id}/gekuendigt`, { gekuendigt, bestaetigt: true });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function alsAufgabe(a: { id: string; name: string }) {
    try {
      const r = await api.post<{ faellig: string }>(`/api/m/finanzen/abo/${a.id}/aufgabe`, {});
      melden(`Aufgabe für ${datum(r.faellig)} angelegt`, 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function bezahlen(r: Rechnung, bezahlt = true) {
    try {
      await api.post(`/api/m/finanzen/rechnung/${r.id}/bezahlt`, { bezahlt });
      if (bezahlt) melden(`«${r.titel}» als bezahlt markiert`, 'ok');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  // ---------- Rechnung schnell erfassen ----------
  let neuTitel = $state('');
  let neuBetrag = $state('');
  let neuFaellig = $state('');
  async function rechnungDazu(e: SubmitEvent) {
    e.preventDefault();
    const betrag = Number(neuBetrag.replace(',', '.').replace(/['’\s]/g, ''));
    if (!neuTitel.trim() || !Number.isFinite(betrag) || betrag < 0 || !neuFaellig) return;
    try {
      await api.post('/api/daten/rechnungen', { titel: neuTitel.trim(), betrag, faellig: neuFaellig, bezahlt: false });
      neuTitel = '';
      neuBetrag = '';
      neuFaellig = '';
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }
  const faelligText = (r: Rechnung) =>
    r.tage == null ? datum(r.faellig) : r.tage < 0 ? `seit ${-r.tage} ${-r.tage === 1 ? 'Tag' : 'Tagen'} überfällig` : r.tage === 0 ? 'heute' : r.tage === 1 ? 'morgen' : `bis ${datum(r.faellig)}`;
</script>

<ModulRahmen modulId="finanzen" tabs={['Übersicht', 'Abos', 'Rechnungen']} bind:tab>
  {#if !u}
    <div class="laedt">Lädt …</div>
  {:else if tab === 'Übersicht'}
    <div class="stapel">
      <div class="kennzahlen">
        <div class="panel"><div class="sehr-klein gedaempft">Fixkosten pro Monat</div><div class="zahl gross">{chf(u.summen.monat)}</div><div class="sehr-klein gedaempft">{chf(u.summen.jahr)} pro Jahr</div></div>
        <div class="panel"><div class="sehr-klein gedaempft">Nächste 30 Tage</div><div class="zahl gross">{chf(u.summen.kommend30)}</div><div class="sehr-klein gedaempft">{u.kommend.length} Belastungen</div></div>
        <div class="panel" class:warnfeld={u.rechnungen.some((r) => (r.tage ?? 0) < 0)}>
          <div class="sehr-klein gedaempft">Offene Rechnungen</div><div class="zahl gross">{chf(u.summen.offen)}</div><div class="sehr-klein gedaempft">{u.rechnungen.length} offen</div>
        </div>
        {#if u.summen.geschaeftMonat != null}
          <div class="panel"><div class="sehr-klein gedaempft">Geschäft (scont)</div><div class="zahl gross">{chf(u.summen.geschaeftMonat)}</div><div class="sehr-klein gedaempft">pro Monat, nicht eingerechnet</div></div>
        {/if}
      </div>

      {#if u.fristen.some((f) => (f.tage ?? 99) <= 60)}
        <div class="panel">
          <h3>Kündigungsfristen</h3>
          <ul class="liste">
            {#each u.fristen.filter((f) => (f.tage ?? 99) <= 60) as f (f.id)}
              <li class="eintrag" class:dringend={dringend(f)}>
                <div class="info"><span class="titel">{f.name}</span><span class="sehr-klein gedaempft">{fristText(f, false)}</span></div>
                <button class="leise klein" onclick={() => alsAufgabe(f)}>Als Aufgabe</button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="raster-2">
        <div class="panel">
          <h3>Belastungen der nächsten zwölf Monate</h3>
          <Balken werte={u.verlauf.map((v) => Math.round(v.summe))} beschriftung={u.verlauf.map((v) => MONATE[Number(v.monat.slice(5, 7)) - 1])} einheit="CHF" hoehe={150} />
          <p class="sehr-klein gedaempft">Abos nach Zahltermin und offene Rechnungen. Jahresbeiträge zeigen sich als Spitzen.</p>
        </div>
        <div class="panel">
          <h3>Pro Monat nach Kategorie</h3>
          {#if !u.kategorien.length}<div class="leer">Noch keine Abos erfasst.</div>{/if}
          <ul class="liste kategorien">
            {#each u.kategorien as k (k.name)}
              <li>
                <div class="zeile-zwischen"><span>{k.name}</span><span class="zahl">{chf(k.betrag)}</span></div>
                <div class="leiste" aria-hidden="true"><span style="width:{(k.betrag / maxKategorie) * 100}%"></span></div>
              </li>
            {/each}
          </ul>
        </div>
      </div>

      <div class="panel">
        <h3>Kommende 30 Tage</h3>
        {#if !u.kommend.length}<div class="leer">Keine Belastungen in den nächsten 30 Tagen.</div>{/if}
        <ul class="liste">
          {#each u.kommend as k, i (i)}
            <li class="eintrag">
              <span class="datum sehr-klein gedaempft">{datum(k.datum)}</span>
              <div class="info"><span class="titel">{k.titel}</span>{#if k.art === 'rechnung'}<span class="sehr-klein gedaempft">Rechnung</span>{/if}</div>
              <span class="zahl">{chf(k.betrag)}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {:else if tab === 'Abos'}
    <div class="stapel">
      <div class="panel">
        {#if !laufend.length}<div class="leer">Noch keine Abos. Unten erfassen.</div>{/if}
        <ul class="liste">
          {#each laufend as a (a.id)}
            <li class="eintrag" class:dringend={!a.gekuendigt && dringend(a.frist)}>
              <div class="info">
                <span class="titel">{a.name}{#if a.gekuendigt}<span class="marke">gekündigt</span>{/if}</span>
                <span class="sehr-klein gedaempft">
                  {a.kategorie ?? 'Andere'}{#if a.naechste}{' · '}nächste Zahlung {datum(a.naechste)}{/if}{#if a.frist}{' · '}{fristText(a.frist, a.gekuendigt)}{/if}
                </span>
              </div>
              <div class="betrag">
                <span class="zahl">{chf(a.betrag)}</span>
                <span class="sehr-klein gedaempft">{INTERVALL[a.intervall] ?? a.intervall}</span>
              </div>
              {#if a.frist?.kuendigenBis && !a.gekuendigt}
                <button class="leise klein" onclick={() => alsAufgabe(a)}>Als Aufgabe</button>
              {/if}
              {#if a.frist}
                <button class="leise klein" onclick={() => alsGekuendigt(a, !a.gekuendigt)}>{a.gekuendigt ? 'Zurücknehmen' : 'Gekündigt'}</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      {#if beendet.length}
        <details class="panel">
          <summary>Beendet ({beendet.length})</summary>
          <ul class="liste">
            {#each beendet as a (a.id)}
              <li class="eintrag ruhig"><div class="info"><span class="titel">{a.name}</span></div><span class="zahl">{chf(a.betrag)}</span></li>
            {/each}
          </ul>
        </details>
      {/if}
      <details class="panel">
        <summary>Abos erfassen und bearbeiten</summary>
        <p class="sehr-klein gedaempft">Kündigungsfrist in Monaten vor dem Vertragsende. Ohne Vertragsende gilt das Abo als jederzeit kündbar. Keine Konto oder Kartennummern erfassen.</p>
        <TabellenEditor tabelle="abos" spalten={['name', 'kategorie', 'betrag', 'intervall', 'naechste_zahlung', 'vertrag_bis', 'kuendigungsfrist_monate', 'aktiv']} sort="name" neuText="Abo" bind:zeilen={aboZeilen} />
      </details>
    </div>
  {:else}
    <div class="stapel">
      <form class="panel erfassen" onsubmit={rechnungDazu}>
        <input class="wachsen" bind:value={neuTitel} placeholder="Rechnung, z.B. «Zahnarzt»" maxlength="120" aria-label="Rechnung" />
        <input class="schmal" bind:value={neuBetrag} placeholder="CHF" inputmode="decimal" aria-label="Betrag in Franken" />
        <input type="date" bind:value={neuFaellig} aria-label="Zahlbar bis" />
        <button class="primaer" disabled={!neuTitel.trim() || !neuBetrag || !neuFaellig}>Dazu</button>
      </form>
      <div class="panel">
        {#if !u.rechnungen.length}<div class="leer">Keine offenen Rechnungen.</div>{/if}
        <ul class="liste">
          {#each u.rechnungen as r (r.id)}
            <li class="eintrag" class:dringend={(r.tage ?? 0) < 0}>
              <button class="haken" aria-label="{r.titel} als bezahlt markieren" onclick={() => bezahlen(r)}></button>
              <div class="info"><span class="titel">{r.titel}</span><span class="sehr-klein gedaempft">{faelligText(r)}</span></div>
              <span class="zahl">{chf(r.betrag)}</span>
            </li>
          {/each}
        </ul>
      </div>
      {#if u.bezahlt.length}
        <details class="panel">
          <summary>Bezahlt in den letzten 60 Tagen ({u.bezahlt.length})</summary>
          <ul class="liste">
            {#each u.bezahlt as r (r.id)}
              <li class="eintrag erledigt">
                <button class="haken an" aria-label="{r.titel} wieder öffnen" onclick={() => bezahlen(r, false)}></button>
                <div class="info"><span class="titel">{r.titel}</span><span class="sehr-klein gedaempft">bezahlt {datum(r.bezahlt_am)}</span></div>
                <span class="zahl">{chf(r.betrag)}</span>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <details class="panel">
        <summary>Alle Rechnungen bearbeiten</summary>
        <TabellenEditor tabelle="rechnungen" spalten={['titel', 'kategorie', 'betrag', 'faellig', 'bezahlt']} sort="-faellig" neuText="Rechnung" bind:zeilen={rechnungZeilen} />
      </details>
    </div>
  {/if}
</ModulRahmen>

<style>
  h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
  .kennzahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .gross { font-size: 1.45rem; font-weight: 600; }
  .warnfeld { border-color: var(--warnung); }
  .liste { list-style: none; padding: 0; margin: 0; }
  .eintrag { display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0; border-bottom: 1px solid var(--rand); }
  .eintrag:last-child { border-bottom: 0; }
  .eintrag .info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .eintrag.dringend .titel { color: var(--warnung); }
  .eintrag.erledigt .titel { text-decoration: line-through; color: var(--text-3); }
  .eintrag.ruhig { opacity: 0.6; }
  .betrag { display: flex; flex-direction: column; align-items: flex-end; }
  .datum { min-width: 4.5rem; }
  .marke { margin-left: 0.4rem; font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 999px; background: var(--flaeche-3); color: var(--text-3); vertical-align: middle; }
  .kategorien li { padding: 0.3rem 0; }
  .leiste { height: 6px; background: var(--flaeche-3); border-radius: 3px; margin-top: 0.25rem; overflow: hidden; }
  .leiste span { display: block; height: 100%; background: var(--akzent); }
  .erfassen { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .erfassen .wachsen { min-width: 10rem; }
  .erfassen .schmal { width: 6.5rem; }
  .haken {
    width: 24px; height: 24px; min-height: 24px; padding: 0; flex-shrink: 0;
    border-radius: 50%; border: 2px solid var(--text-3); background: transparent; cursor: pointer;
  }
  .haken:hover { border-color: var(--ok); }
  .haken.an { background: var(--ok); border-color: var(--ok); }
  .haken.an::after { content: '✓'; color: var(--bg); font-size: 14px; line-height: 20px; display: block; text-align: center; }
  summary { cursor: pointer; font-weight: 600; font-size: 0.9rem; }
  details[open] summary { margin-bottom: 0.5rem; }
  @media (pointer: coarse) {
    .haken { width: 32px; height: 32px; min-height: 32px; }
    .haken.an::after { line-height: 28px; }
  }
</style>
