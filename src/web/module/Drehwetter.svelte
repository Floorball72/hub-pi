<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import { api } from '../lib/api.ts';
  import { datumZeit, zeit } from '../lib/format.ts';

  interface Eintrag {
    dreh: { id: string; titel: string; termin: string; dauer_min: number | null; status: string };
    ort: string;
    urteil: { ok: boolean; gruende: string[]; unbekannt: boolean };
    alternativen: { start: string; ende: string }[];
    verlauf: { stufe: string; ok: boolean; erstellt: string }[];
    fehler?: string;
    demo: boolean;
  }
  let tab = $state('Drehs');
  let d = $state<{ drehs: Eintrag[]; stufen: number[] } | null>(null);
  $effect(() => {
    api.get<{ drehs: Eintrag[]; stufen: number[] }>('/api/m/drehwetter/uebersicht').then((x) => (d = x));
  });
  const stunden = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 3600000);
</script>

<ModulRahmen modulId="drehwetter" tabs={['Drehs']} bind:tab>
  {#if !d}
    <div class="laedt" style="height:260px"></div>
  {:else}
    <div class="stapel">
      {#each d.drehs as e (e.dreh.id)}
        <div class="panel dreh" class:gefaehrdet={!e.urteil.ok}>
          <div class="zeile-zwischen">
            <div>
              <strong>{e.dreh.titel}</strong>
              <div class="sehr-klein gedaempft">{datumZeit(e.dreh.termin)} bis {zeit(new Date(Date.parse(e.dreh.termin) + (e.dreh.dauer_min ?? 120) * 60000).toISOString())} · {e.ort} · in {stunden(e.dreh.termin)} h</div>
            </div>
            {#if e.urteil.unbekannt}<span class="marke">noch keine Prognose</span>{:else if e.urteil.ok}<span class="marke ok">Wetter passt</span>{:else}<span class="marke warnung">gefährdet</span>{/if}
          </div>
          {#if !e.urteil.ok}
            <div class="klein">Gründe: {e.urteil.gruende.join(', ')}</div>
            <div class="klein" style="margin-top:6px"><strong>Ausweichtermine</strong> <span class="sehr-klein gedaempft">(Wetter gut, Tageslicht, keine Überschneidung mit Kalender, Einsätzen, Veranstaltungen und anderen Drehs)</span></div>
            <ul class="liste">
              {#each e.alternativen as a (a.start)}<li class="klein">{datumZeit(a.start)} bis {zeit(a.ende)}</li>{:else}<li class="leer">Kein passender Termin in den nächsten Tagen.</li>{/each}
            </ul>
          {/if}
          {#if e.fehler}<div class="hinweis ausfall klein">{e.fehler}</div>{/if}
          <div class="zeile sehr-klein gedaempft">
            Prüfpunkte:
            {#each d.stufen as s (s)}
              {@const v = e.verlauf.find((x) => x.stufe === String(s))}
              <span class="marke {v ? (v.ok ? 'ok' : 'warnung') : ''}">{s} h{v ? (v.ok ? ' ok' : ' gefährdet') : ''}</span>
            {/each}
          </div>
        </div>
      {:else}
        <p class="leer">Keine Kundendrehs in den nächsten 8 Tagen. Drehs werden im Modul Drohne unter «Kundendrehs» erfasst (mit Ort und Dauer).</p>
      {/each}
    </div>
    <p class="sehr-klein gedaempft" style="margin-top:10px">Geprüft wird das Mindestwetter des Drehorts (Modul Drohne, Orte) 72, 48, 24 und 4 Stunden vor dem Termin. Der Hub verschiebt nie selbst, er meldet nur und schlägt vor. Wetterdaten: Open-Meteo.</p>
  {/if}
</ModulRahmen>

<style>
  .dreh {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dreh.gefaehrdet {
    border-color: #fbbf2466;
  }
</style>
