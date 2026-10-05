<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datumZeit } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';

  interface Ereignis { id: string; start: string; ende: string | null; wert: number; median: number; z: number; richtung: string; rueckmeldung: string | null }
  interface Metrik {
    id: string;
    name: string;
    einheit: string;
    modul: string;
    letzter: { wert: number; zeit: number } | null;
    basis: { median: number; mad: number; n: number } | null;
    streuung: number | null;
    schwelle: number | null;
    lernTageOffen: number;
    einstellung: { empfindlichkeit?: string; faktor?: number };
    verlauf: { zeit: string; wert: number }[];
    band: ({ min: number; max: number } | null)[];
    ereignisse: Ereignis[];
  }
  interface Antwort { metriken: Metrik[]; empfindlichkeit: string; lerntage: number }

  const STUFEN = ['aus', 'niedrig', 'normal', 'hoch'];
  let tab = $state('Messwerte');
  let d = $state<Antwort | null>(null);

  async function laden() {
    d = await api.get<Antwort>('/api/m/auffaelligkeiten/uebersicht');
  }
  $effect(() => {
    laden();
  });

  async function global(e: string) {
    await api.put('/api/m/auffaelligkeiten/empfindlichkeit', { empfindlichkeit: e });
    await laden();
  }
  async function proMetrik(m: Metrik, e: string) {
    await api.put(`/api/m/auffaelligkeiten/metrik/${encodeURIComponent(m.id)}`, { empfindlichkeit: e || null });
    await laden();
  }
  async function rueckmeldung(e: Ereignis, r: 'normal' | 'relevant') {
    try {
      const x = await api.post<{ faktor: number }>(`/api/m/auffaelligkeiten/ereignis/${e.id}/rueckmeldung`, { rueckmeldung: r });
      melden(r === 'normal' ? `Danke. Diese Metrik meldet künftig etwas später (Faktor ${x.faktor}).` : `Danke. Diese Metrik meldet künftig etwas früher (Faktor ${x.faktor}).`);
      await laden();
    } catch (err) {
      melden(fehlerText(err), 'ausfall');
    }
  }

  const fmt = (x: number | null | undefined, e = '') => (x === null || x === undefined ? '–' : `${Math.round(x * 10) / 10}${e ? ` ${e}` : ''}`);

  /** Mini Diagramm: Linie der letzten 48 Stunden mit dem Normalbereich als Band */
  function pfad(m: Metrik, b = 300, h = 64) {
    const werte = m.verlauf.map((v) => v.wert);
    const bandWerte = m.band.flatMap((x) => (x ? [x.min, x.max] : []));
    const alle = [...werte, ...bandWerte, ...(m.letzter ? [m.letzter.wert] : [])];
    if (!werte.length) return null;
    const min = Math.min(...alle);
    const max = Math.max(...alle);
    const y = (v: number) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
    const x = (i: number) => (i / Math.max(1, werte.length - 1)) * b;
    const linie = werte.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const oben = m.band.map((z, i) => (z ? `${x(i).toFixed(1)},${y(z.max).toFixed(1)}` : null)).filter(Boolean);
    const unten = m.band.map((z, i) => (z ? `${x(i).toFixed(1)},${y(z.min).toFixed(1)}` : null)).filter(Boolean).reverse();
    return { linie, band: oben.length ? `M${oben.join(' L')} L${unten.join(' L')} Z` : null, b, h };
  }
  const offen = (m: Metrik) => m.ereignisse.some((e) => !e.ende);
</script>

<ModulRahmen modulId="auffaelligkeiten" tabs={['Messwerte']} bind:tab>
  {#if !d}
    <div class="laedt" style="height:300px"></div>
  {:else}
    <div class="panel zeile-zwischen" style="margin-bottom:12px;flex-wrap:wrap">
      <div>
        <strong>Empfindlichkeit</strong>
        <div class="sehr-klein gedaempft">Gilt für alle Messwerte ohne eigene Einstellung. Meldungen nach {d.lerntage} Tagen Lernphase, erst wenn eine Abweichung anhält.</div>
      </div>
      <div class="umschalter">
        {#each STUFEN as s (s)}<button class="klein" class:aktiv={d.empfindlichkeit === s} onclick={() => global(s)}>{s}</button>{/each}
      </div>
    </div>
    <div class="raster">
      {#each d.metriken as m (m.id)}
        {@const p = pfad(m)}
        <div class="panel metrik" class:auffaellig={offen(m)}>
          <div class="zeile-zwischen">
            <div>
              <strong>{m.name}</strong>
              <div class="sehr-klein gedaempft">{m.modul}</div>
            </div>
            {#if m.lernTageOffen > 0}<span class="marke">lernt noch {m.lernTageOffen} Tage</span>{:else if offen(m)}<span class="marke warnung">auffällig</span>{:else}<span class="marke ok">normal</span>{/if}
          </div>
          <div class="zeile" style="align-items:baseline">
            <span class="zahl gross">{fmt(m.letzter?.wert)}</span><span class="klein gedaempft">{m.einheit}</span>
          </div>
          <div class="sehr-klein gedaempft">
            {#if m.basis && m.streuung !== null && m.schwelle !== null}
              Normal um diese Zeit: {fmt(m.basis.median >= 0 ? Math.max(0, m.basis.median - m.schwelle * m.streuung) : m.basis.median - m.schwelle * m.streuung)} bis {fmt(m.basis.median + m.schwelle * m.streuung, m.einheit)} (Median {fmt(m.basis.median)}, {m.basis.n} Stunden)
            {:else if m.schwelle === null}
              Überwachung ausgeschaltet
            {:else}
              Noch zu wenig Daten für einen Normalbereich
            {/if}
          </div>
          {#if p}
            <svg viewBox="0 0 {p.b} {p.h}" class="mini" role="img" aria-label="Verlauf der letzten 48 Stunden mit Normalbereich">
              {#if p.band}<path d={p.band} class="band" />{/if}
              <path d={p.linie} class="linie" />
            </svg>
            <div class="sehr-klein gedaempft zeile-zwischen"><span>vor 48 h</span><span>Band: Normalbereich</span><span>jetzt</span></div>
          {/if}
          {#each m.ereignisse.slice(0, 2) as e (e.id)}
            <div class="ereignis klein">
              <div>{e.richtung === 'hoch' ? 'Zu hoch' : 'Zu tief'}: {fmt(e.wert, m.einheit)} statt {fmt(e.median)} · {datumZeit(e.start)}{e.ende ? '' : ' · läuft'}</div>
              {#if e.rueckmeldung}
                <div class="sehr-klein gedaempft">Rückmeldung: {e.rueckmeldung}</div>
              {:else}
                <div class="zeile"><button class="klein" onclick={() => rueckmeldung(e, 'normal')}>War normal</button><button class="klein" onclick={() => rueckmeldung(e, 'relevant')}>War relevant</button></div>
              {/if}
            </div>
          {/each}
          <div class="zeile sehr-klein">
            <label for="e-{m.id}" style="margin:0">Empfindlichkeit</label>
            <select id="e-{m.id}" style="width:auto;min-height:28px;padding:2px 6px" value={m.einstellung.empfindlichkeit ?? ''} onchange={(ev) => proMetrik(m, (ev.target as HTMLSelectElement).value)}>
              <option value="">wie global</option>
              {#each STUFEN as s (s)}<option value={s}>{s}</option>{/each}
            </select>
            {#if m.einstellung.faktor && m.einstellung.faktor !== 1}<span class="gedaempft">Faktor {m.einstellung.faktor} aus Rückmeldungen</span>{/if}
          </div>
        </div>
      {:else}
        <p class="leer">Noch keine Messwerte gemeldet.</p>
      {/each}
    </div>
    <p class="sehr-klein gedaempft" style="margin-top:10px">Normalbereich: Median und mittlere absolute Abweichung der Stundenwerte der letzten 4 Wochen, getrennt nach Werktag und Wochenende und Stunde. Jede Nacht neu berechnet.</p>
  {/if}
</ModulRahmen>

<style>
  .umschalter {
    display: inline-flex;
    gap: 2px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    border-radius: var(--radius-klein);
    padding: 2px;
  }
  .umschalter button {
    border-color: transparent;
    background: transparent;
  }
  .umschalter button.aktiv {
    background: var(--flaeche-3);
    border-color: var(--rand-hell);
  }
  .metrik {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .metrik.auffaellig {
    border-color: #fbbf2466;
  }
  .gross {
    font-size: 1.6rem;
  }
  .mini {
    width: 100%;
    height: 64px;
  }
  .band {
    fill: #4cc9f01f;
    stroke: none;
  }
  .linie {
    fill: none;
    stroke: var(--akzent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .ereignis {
    background: color-mix(in srgb, var(--warnung) 10%, transparent);
    border-radius: 6px;
    padding: 6px 8px;
  }
</style>
