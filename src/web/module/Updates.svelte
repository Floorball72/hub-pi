<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Status {
    repo: string;
    zweig: string;
    release: string;
    aktuell: string | null;
    neuester: { sha: string; datum: string | null; text: string } | null;
    neuerStand: boolean;
    fehler?: string;
    auto: boolean;
    fenster: { von: string; bis: string };
    versionen: string[];
    ergebnis: { zeit: string; ok: boolean; schritt: string; meldung: string; commit: string } | null;
    installiert: boolean;
    demo: boolean;
  }
  let tab = $state('Übersicht');
  let s = $state<Status | null>(null);
  let von = $state('02:30');
  let bis = $state('04:30');

  async function laden() {
    s = await api.get<Status>('/api/m/updates/status');
    von = s.fenster.von;
    bis = s.fenster.bis;
  }
  $effect(() => {
    laden();
  });
  async function autoSetzen(wert: boolean) {
    const text = wert ? `Der Hub spielt neue Stände aus ${s?.repo} automatisch zwischen ${von} und ${bis} ein, nur wenn der Selbsttest grün ist. Bei Fehlern schaltet er zurück.` : 'Updates gibt es dann nur noch von Hand.';
    if (!(await bestaetigen(wert ? 'Automatische Updates einschalten?' : 'Automatische Updates ausschalten?', text, wert ? 'Einschalten' : 'Ausschalten'))) return;
    try {
      await api.put('/api/m/updates/einstellungen', { auto: wert, von, bis });
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function fensterSpeichern() {
    try {
      await api.put('/api/m/updates/einstellungen', { von, bis });
      melden('Nachtfenster gespeichert');
      await laden();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  async function jetzt() {
    if (!(await bestaetigen('Jetzt aktualisieren?', 'Der Hub baut die neue Version, sichert die Daten, startet neu und prüft sich. Das dauert auf dem Pi einige Minuten.', 'Aktualisieren'))) return;
    try {
      const r = await api.post<{ meldung: string }>('/api/m/updates/jetzt', { bestaetigt: true });
      melden(r.meldung);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }
  const kurz = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–');
</script>

<ModulRahmen modulId="updates" tabs={['Übersicht']} bind:tab>
  {#if !s}
    <div class="laedt" style="height:260px"></div>
  {:else}
    <div class="raster-2">
      <div class="panel stapel">
        <h3 style="margin:0">Stand</h3>
        <div class="zeile-zwischen"><span class="gedaempft klein">Laufende Version</span><span class="mono">{s.release} · {kurz(s.aktuell)}</span></div>
        <div class="zeile-zwischen"><span class="gedaempft klein">Neuester Stand {s.repo} ({s.zweig})</span><span class="mono">{kurz(s.neuester?.sha)}</span></div>
        {#if s.neuester}<div class="sehr-klein gedaempft">{s.neuester.text}{s.neuester.datum ? ` · ${datumZeit(s.neuester.datum)}` : ''}</div>{/if}
        {#if s.fehler}<div class="hinweis ausfall klein">{s.fehler}</div>{/if}
        {#if s.neuerStand}<div class="hinweis warnung klein">Es gibt einen neueren Stand.</div>{:else if s.neuester}<div class="hinweis ok klein">Der Hub ist aktuell.</div>{/if}
        <button class="primaer" disabled={!s.installiert} onclick={jetzt}>Jetzt aktualisieren</button>
        {#if !s.installiert}<p class="sehr-klein gedaempft">Nur auf dem installierten Pi verfügbar.</p>{/if}
      </div>
      <div class="panel stapel">
        <h3 style="margin:0">Automatisch</h3>
        <label class="zeile" style="margin:0;color:var(--text)"><span class="schalter"><input type="checkbox" checked={s.auto} onchange={(e) => autoSetzen((e.target as HTMLInputElement).checked)} /><span></span></span>Automatische Updates im Nachtfenster</label>
        <div class="zeile">
          <div class="feld" style="margin:0"><label for="uv">von</label><input id="uv" type="time" bind:value={von} style="width:auto" /></div>
          <div class="feld" style="margin:0"><label for="ub">bis</label><input id="ub" type="time" bind:value={bis} style="width:auto" /></div>
          <button class="klein" style="align-self:flex-end" onclick={fensterSpeichern}>Speichern</button>
        </div>
        <p class="sehr-klein gedaempft">Ablauf: Selbsttest der laufenden Version muss grün sein. Neuer Stand nur aus {s.repo}, Branch {s.zweig}. Bau in einem eigenen Ordner, Backup, Migrationen (nur hinzufügend), Umschalten, Gesundheitscheck und Selbsttest. Bei einem Fehler zurück auf die vorherige Version. Die letzten 3 Versionen bleiben erhalten.</p>
      </div>
      <div class="panel">
        <h3>Letztes Update</h3>
        {#if s.ergebnis}
          <div class="zeile"><span class="marke {s.ergebnis.ok ? 'ok' : 'ausfall'}">{s.ergebnis.ok ? 'erfolgreich' : 'fehlgeschlagen'}</span><span class="klein">{datumZeit(s.ergebnis.zeit)}</span></div>
          <p class="klein">{s.ergebnis.meldung}</p>
          {#if !s.ergebnis.ok}<p class="sehr-klein gedaempft">Schritt: {s.ergebnis.schritt}. Details: /opt/pihub/logs/release.log</p>{/if}
        {:else}<p class="leer">Noch kein Update über den Hub.</p>{/if}
      </div>
      <div class="panel">
        <h3>Versionen auf dem Pi</h3>
        <ul class="liste">{#each s.versionen as v, i (v)}<li class="zeile"><span class="mono wachsen">{v}</span>{#if v === s.release || (s.demo && i === 0)}<span class="marke ok">aktiv</span>{/if}</li>{:else}<li class="leer">Keine Versionen gefunden.</li>{/each}</ul>
      </div>
    </div>
  {/if}
</ModulRahmen>
