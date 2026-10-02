<script lang="ts">
  import type { QuellenStatusInfo } from '../../server/geteilt/typen.ts';
  import { relativ } from '../lib/format.ts';

  let { quellen }: { quellen: QuellenStatusInfo[] } = $props();

  const TEXT: Record<string, string> = {
    ok: 'in Ordnung',
    fehler: 'Fehler',
    unbekannt: 'noch nicht abgefragt',
    aus: 'ausgeschaltet',
    nicht_konfiguriert: 'nicht konfiguriert',
    demo: 'Demo Daten',
  };
  const AMPEL: Record<string, string> = { ok: 'ok', fehler: 'ausfall', nicht_konfiguriert: 'warnung', demo: 'demo' };
</script>

{#if !quellen.length}
  <p class="leer">Dieses Modul nutzt keine externen Quellen.</p>
{:else}
  <ul class="liste">
    {#each quellen as q (q.id)}
      <li>
        <div class="zeile-zwischen">
          <div class="zeile">
            <span class="punkt {AMPEL[q.zustand] === 'demo' ? '' : (AMPEL[q.zustand] ?? '')}"></span>
            <strong>{q.name}</strong>
            {#if q.ungetestet}<span class="marke warnung" title="Von der Entwicklungsumgebung aus nicht geprüft">ungetestet</span>{/if}
          </div>
          <span class="marke {AMPEL[q.zustand] ?? ''}">{TEXT[q.zustand] ?? q.zustand}</span>
        </div>
        <div class="sehr-klein gedaempft">
          {#if q.letzterErfolg}Zuletzt erfolgreich {relativ(q.letzterErfolg)}{/if}
          {#if q.latenzMs !== null} · {q.latenzMs} ms{/if}
          {#if q.fehlerText} · <span style="color:var(--ausfall)">{q.fehlerText}</span>{/if}
        </div>
        {#if q.namensnennung}<div class="sehr-klein gedaempft">Quelle: {q.namensnennung}</div>{/if}
      </li>
    {/each}
  </ul>
{/if}
