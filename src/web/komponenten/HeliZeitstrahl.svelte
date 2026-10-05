<script lang="ts">
  // Zeitstrahl der Heli Flüge seit gestern Abend oder seit Mitternacht: eine Zeile pro Heli, ein Balken pro Flug.
  import { heliFarbe } from '../../server/geteilt/heli.ts';
  import { api } from '../lib/api.ts';

  interface RueckblickFlug {
    id: string;
    hex: string;
    organisation: string;
    kennzeichen: string | null;
    start: string;
    ende: string | null;
    von: string | null;
    nach: string | null;
    laufend: boolean;
  }
  interface Rueckblick {
    titel: string;
    von: string;
    fluege: RueckblickFlug[];
    demo: boolean;
  }

  let { maxZeilen = 10 }: { maxZeilen?: number } = $props();

  let rb = $state<Rueckblick | null>(null);
  let fehler = $state(false);
  let jetzt = $state(Date.now());

  $effect(() => {
    const holen = () =>
      api
        .get<Rueckblick>('/api/m/rettung/rueckblick')
        .then((r) => {
          rb = r;
          fehler = false;
          jetzt = Date.now();
        })
        .catch(() => (fehler = true));
    holen();
    const t = setInterval(holen, 60000);
    return () => clearInterval(t);
  });

  const uhr = (ms: number) => new Date(ms).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });

  const beginn = $derived(rb ? new Date(rb.von).getTime() : 0);
  const spanne = $derived(Math.max(1, jetzt - beginn));
  const pos = (ms: number) => Math.min(100, Math.max(0, ((ms - beginn) / spanne) * 100));

  // Eine Zeile pro Heli, sortiert nach dem ersten Start
  const zeilen = $derived.by(() => {
    const m = new Map<string, { hex: string; name: string; organisation: string; fluege: RueckblickFlug[] }>();
    for (const f of rb?.fluege ?? []) {
      let z = m.get(f.hex);
      if (!z) {
        z = { hex: f.hex, name: f.kennzeichen ?? f.hex, organisation: f.organisation, fluege: [] };
        m.set(f.hex, z);
      }
      z.fluege.push(f);
    }
    return [...m.values()];
  });

  const stunde = new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: 'numeric', hourCycle: 'h23' });

  // Volle Stunden als Raster, je nach Spanne alle 2, 3 oder 4 Stunden beschriftet
  const marken = $derived.by(() => {
    if (!rb) return [];
    const schritt = spanne > 14 * 3600000 ? 4 : spanne > 7 * 3600000 ? 3 : 2;
    const aus: { ms: number; text: string }[] = [];
    let t = Math.ceil(beginn / 3600000) * 3600000;
    for (; t < jetzt; t += 3600000) {
      const h = Number(stunde.formatToParts(t).find((p) => p.type === 'hour')?.value);
      if (h % schritt === 0) aus.push({ ms: t, text: `${h}h` });
    }
    return aus;
  });

  const dauer = (f: RueckblickFlug) => Math.max(1, Math.round(((f.ende ? new Date(f.ende).getTime() : jetzt) - new Date(f.start).getTime()) / 60000));
  const beschreibung = (f: RueckblickFlug) =>
    `${f.organisation} ${f.kennzeichen ?? f.hex}: ${f.von ?? '?'} nach ${f.laufend ? 'unterwegs' : (f.nach ?? '?')}, ${uhr(new Date(f.start).getTime())}${f.ende ? ` bis ${uhr(new Date(f.ende).getTime())}` : ''} (${dauer(f)} min)`;
</script>

{#if rb}
  <div class="zs">
    <div class="zeile-zwischen">
      <h3>Rückblick: {rb.titel.toLowerCase() === 'heute' ? 'heute' : rb.titel}</h3>
      <span class="sehr-klein gedaempft">{rb.fluege.length} {rb.fluege.length === 1 ? 'Flug' : 'Flüge'}{#if rb.demo} <span class="marke demo">Demo</span>{/if}</span>
    </div>
    {#if zeilen.length}
      <div class="zs-raster">
        {#each zeilen.slice(0, maxZeilen) as z (z.hex)}
          <a class="zs-name klein" href="/heli?hex={encodeURIComponent(z.hex)}" title={z.organisation}>
            <span class="punkt" style="background:{heliFarbe(z.organisation)}"></span>{z.name}
          </a>
          <div class="zs-spur">
            {#each marken as mk (mk.ms)}<span class="zs-linie" style="left:{pos(mk.ms)}%"></span>{/each}
            {#each z.fluege as f (f.id)}
              <a
                class="zs-balken"
                class:laufend={f.laufend}
                href="/heli?hex={encodeURIComponent(f.hex)}"
                title={beschreibung(f)}
                aria-label={beschreibung(f)}
                style="left:{pos(new Date(f.start).getTime())}%;width:max(6px, {pos(f.ende ? new Date(f.ende).getTime() : jetzt) - pos(new Date(f.start).getTime())}%);--farbe:{heliFarbe(f.organisation)}"
              ></a>
            {/each}
          </div>
        {/each}
        <span></span>
        <div class="zs-achse sehr-klein gedaempft">
          {#each marken as mk (mk.ms)}<span style="left:{pos(mk.ms)}%">{mk.text}</span>{/each}
          <span class="jetzt" style="left:100%">jetzt</span>
        </div>
      </div>
      {#if zeilen.length > maxZeilen}<p class="sehr-klein gedaempft">und {zeilen.length - maxZeilen} weitere Helis</p>{/if}
    {:else}
      <p class="leer">Keine Flüge der Helis aus deiner Liste erfasst.</p>
    {/if}
  </div>
{:else if fehler}
  <p class="klein gedaempft">Rückblick gerade nicht verfügbar.</p>
{/if}

<style>
  .zs h3 {
    margin: 0 0 8px;
  }
  .zs-raster {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 6px;
    align-items: center;
  }
  .zs-name {
    display: flex;
    align-items: center;
    gap: 6px;
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }
  @media (hover: hover) and (pointer: fine) {
    .zs-name:hover {
      text-decoration: underline;
    }
  }
  .zs-spur {
    position: relative;
    height: 18px;
    border-radius: 6px;
    background: var(--flaeche);
    border: 1px solid var(--rand);
  }
  .zs-linie {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--rand);
  }
  .zs-balken {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 4px;
    background: var(--farbe);
    opacity: 0.85;
    transform: translateX(-1px);
  }
  @media (hover: hover) and (pointer: fine) {
    .zs-balken:hover {
      opacity: 1;
      outline: 2px solid var(--text);
    }
  }
  .zs-balken.laufend {
    background: repeating-linear-gradient(45deg, var(--farbe) 0 6px, transparent 6px 10px);
    border: 1px solid var(--farbe);
    animation: pulsieren 1.6s ease-in-out infinite;
  }
  .zs-achse {
    position: relative;
    height: 16px;
  }
  .zs-achse span {
    position: absolute;
    transform: translateX(-50%);
  }
  .zs-achse .jetzt {
    transform: translateX(-100%);
  }
</style>
