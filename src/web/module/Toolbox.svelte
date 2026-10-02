<script lang="ts">
  import { dosis, GCS, gcs, HINWEIS, news2, runden, sauerstoffMinuten, tropfen, UMRECHNUNGEN } from '../../server/geteilt/toolbox.ts';

  let rechner = $state('GCS');
  // GCS
  let a = $state(4);
  let v = $state(5);
  let m = $state(6);
  const g = $derived(gcs(a, v, m));
  // NEWS2
  let n = $state({ atemfrequenz: 16, spo2: 97, skala2: false, sauerstoff: false, systolisch: 125, puls: 78, bewusstseinVeraendert: false, temperatur: 36.8 });
  const ns = $derived(news2(n));
  // Tropfen
  let vol = $state(500);
  let min = $state(120);
  let faktor = $state(20);
  const tr = $derived(tropfen(vol, min, faktor));
  // Dosis
  let mgkg = $state(0.1);
  let kg = $state(70);
  let konz = $state(10);
  const ds = $derived(dosis(mgkg, kg, konz));
  // Sauerstoff
  let flasche = $state(2);
  let druck = $state(200);
  let fluss = $state(10);
  let rest = $state(20);
  const o2 = $derived(sauerstoffMinuten(flasche, druck, fluss, rest));
  // Umrechnung
  let um = $state(UMRECHNUNGEN[0].id);
  let wert = $state(37);
  const u = $derived(UMRECHNUNGEN.find((x) => x.id === um)!);
  const GCS_GRUPPEN = [
    { titel: 'Augen', optionen: GCS.augen, k: 'a' },
    { titel: 'Verbal', optionen: GCS.verbal, k: 'v' },
    { titel: 'Motorik', optionen: GCS.motorik, k: 'm' },
  ];
  const RECHNER = ['GCS', 'NEWS2', 'Tropfen', 'Dosis', 'Sauerstoff', 'Umrechnen'];
</script>

<div class="hinweis warnung warnhinweis"><strong>{HINWEIS}.</strong> Formeln vor dem Gebrauch prüfen. Massgebend sind die Vorgaben deines Rettungsdienstes.</div>

<nav class="tabs">
  {#each RECHNER as r (r)}<button class:aktiv={rechner === r} onclick={() => (rechner = r)}>{r}</button>{/each}
</nav>

<div class="panel rechner">
  {#if rechner === 'GCS'}
    <h2>Glasgow Coma Scale</h2>
    <div class="raster-3">
      {#each GCS_GRUPPEN as { titel, optionen, k } (k)}
        <div>
          <h3>{titel}</h3>
          {#each optionen as { wert: w, text: t } (w)}
            <label class="option"><input type="radio" name="gcs-{k}" value={w} checked={(k === 'a' ? a : k === 'v' ? v : m) === w} onchange={() => (k === 'a' ? (a = w) : k === 'v' ? (v = w) : (m = w))} />{w} {t}</label>
          {/each}
        </div>
      {/each}
    </div>
    <div class="ergebnis"><span class="zahl gross">{g.summe}</span><span>{g.text} · Schädelhirntrauma {g.einteilung}</span></div>
    <p class="quelle">Quelle: {GCS.quelle}</p>
  {:else if rechner === 'NEWS2'}
    <h2>NEWS2</h2>
    <div class="felder">
      <div><label for="n1">Atemfrequenz /min</label><input id="n1" type="number" bind:value={n.atemfrequenz} /></div>
      <div><label for="n2">SpO2 %</label><input id="n2" type="number" bind:value={n.spo2} /></div>
      <div><label for="n3">Systolischer Blutdruck mmHg</label><input id="n3" type="number" bind:value={n.systolisch} /></div>
      <div><label for="n4">Puls /min</label><input id="n4" type="number" bind:value={n.puls} /></div>
      <div><label for="n5">Temperatur °C</label><input id="n5" type="number" step="0.1" bind:value={n.temperatur} /></div>
    </div>
    <label class="option"><input type="checkbox" bind:checked={n.sauerstoff} />Sauerstoffgabe</label>
    <label class="option"><input type="checkbox" bind:checked={n.skala2} />SpO2 Skala 2 (Zielbereich 88 bis 92 %, nur ärztlich festgelegt)</label>
    <label class="option"><input type="checkbox" bind:checked={n.bewusstseinVeraendert} />Neu verwirrt oder reagiert nur auf Ansprache, Schmerz oder nicht (ACVPU nicht A)</label>
    <div class="ergebnis"><span class="zahl gross">{ns.summe}</span><span>Klinisches Risiko: {ns.risiko}</span></div>
    <div class="klein gedaempft">{Object.entries(ns.punkte).map(([k, p]) => `${k} ${p}`).join(' · ')}</div>
    <p class="quelle">Quelle: {ns.quelle}</p>
  {:else if rechner === 'Tropfen'}
    <h2>Tropfrechner</h2>
    <div class="felder">
      <div><label for="t1">Volumen ml</label><input id="t1" type="number" bind:value={vol} /></div>
      <div><label for="t2">Laufzeit Minuten</label><input id="t2" type="number" bind:value={min} /></div>
      <div><label for="t3">Tropffaktor (Tropfen pro ml)</label><select id="t3" bind:value={faktor}><option value={20}>20 (Standard)</option><option value={60}>60 (Mikro)</option><option value={15}>15</option></select></div>
    </div>
    {#if tr}<div class="ergebnis"><span class="zahl gross">{tr.tropfenProMinute}</span><span>Tropfen pro Minute · {tr.mlProStunde} ml/h</span></div><p class="quelle">Quelle: {tr.quelle}</p>{/if}
  {:else if rechner === 'Dosis'}
    <h2>Dosis nach Körpergewicht</h2>
    <div class="felder">
      <div><label for="d1">mg pro kg</label><input id="d1" type="number" step="0.01" bind:value={mgkg} /></div>
      <div><label for="d2">Gewicht kg</label><input id="d2" type="number" bind:value={kg} /></div>
      <div><label for="d3">Konzentration mg pro ml</label><input id="d3" type="number" step="0.01" bind:value={konz} /></div>
    </div>
    {#if ds}<div class="ergebnis"><span class="zahl gross">{ds.mg} mg</span><span>{ds.ml !== null ? `${ds.ml} ml` : ''}</span></div><p class="quelle">Rechenweg: mg/kg × kg, Volumen = Dosis / Konzentration. Maximaldosen beachten.</p>{/if}
  {:else if rechner === 'Sauerstoff'}
    <h2>Sauerstoff Vorrat</h2>
    <div class="felder">
      <div><label for="o1">Flasche Liter</label><input id="o1" type="number" step="0.5" bind:value={flasche} /></div>
      <div><label for="o2">Druck bar</label><input id="o2" type="number" bind:value={druck} /></div>
      <div><label for="o3">Fluss l/min</label><input id="o3" type="number" bind:value={fluss} /></div>
      <div><label for="o4">Restdruck bar</label><input id="o4" type="number" bind:value={rest} /></div>
    </div>
    {#if o2}<div class="ergebnis"><span class="zahl gross">{o2.minuten} min</span><span>{o2.liter} Liter nutzbar</span></div><p class="quelle">Quelle: {o2.quelle}</p>{/if}
  {:else}
    <h2>Umrechnen</h2>
    <div class="felder">
      <div><label for="u1">Umrechnung</label><select id="u1" bind:value={um}>{#each UMRECHNUNGEN as x (x.id)}<option value={x.id}>{x.von} und {x.nach}</option>{/each}</select></div>
      <div><label for="u2">Wert</label><input id="u2" type="number" step="any" bind:value={wert} /></div>
    </div>
    <div class="ergebnis"><span class="zahl gross">{runden(u.hin(wert))} {u.nach}</span><span>{wert} {u.von}</span></div>
    <div class="ergebnis"><span class="zahl gross">{runden(u.zurueck(wert))} {u.von}</span><span>{wert} {u.nach}</span></div>
    <p class="quelle">Quelle: {u.quelle}</p>
  {/if}
</div>

<style>
  .warnhinweis {
    margin-bottom: 12px;
  }
  .rechner h3 {
    margin-top: 6px;
  }
  .raster-3 {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
  .option {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--text);
    font-size: 0.9rem;
    padding: 4px 0;
    cursor: pointer;
  }
  .option input[type='radio'] {
    width: 18px;
    min-height: 0;
    accent-color: var(--akzent);
  }
  .felder {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    margin-bottom: 10px;
  }
  .ergebnis {
    display: flex;
    gap: 14px;
    align-items: baseline;
    flex-wrap: wrap;
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--flaeche-3);
  }
  .gross {
    font-size: 2.2rem;
    color: var(--akzent);
  }
  .quelle {
    font-size: 0.75rem;
    color: var(--text-3);
    margin-top: 10px;
  }
</style>
