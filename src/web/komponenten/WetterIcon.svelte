<script lang="ts">
  import { wetterSymbol } from '../../server/geteilt/wetter.ts';

  let { code, tag = true, groesse = 32 }: { code: number | null; tag?: boolean; groesse?: number } = $props();
  const art = $derived(wetterSymbol(code, tag));
</script>

<svg width={groesse} height={groesse} viewBox="0 0 32 32" aria-hidden="true" class="wetter-icon">
  {#if art === 'sonne' || art === 'sonne-wolke'}
    <circle cx={art === 'sonne' ? 16 : 12} cy={art === 'sonne' ? 16 : 12} r="6" fill="#fbbf24" />
    {#each [0, 45, 90, 135, 180, 225, 270, 315] as w (w)}
      <line x1={art === 'sonne' ? 16 : 12} y1={art === 'sonne' ? 5 : 2} x2={art === 'sonne' ? 16 : 12} y2={art === 'sonne' ? 7.5 : 4} stroke="#fbbf24" stroke-width="2" stroke-linecap="round" transform="rotate({w} {art === 'sonne' ? 16 : 12} {art === 'sonne' ? 16 : 12})" />
    {/each}
  {/if}
  {#if art === 'mond' || art === 'mond-wolke'}
    <path d="M17 6a9 9 0 1 0 9 12A7 7 0 0 1 17 6z" fill="#c7d2fe" />
  {/if}
  {#if art !== 'sonne' && art !== 'mond' && art !== 'unbekannt'}
    <path d="M9 25h14a5 5 0 0 0 .6-10 7 7 0 0 0-13.4 2A4 4 0 0 0 9 25z" fill={art === 'gewitter' ? '#64748b' : '#94a3b8'} />
  {/if}
  {#if art === 'regen'}
    {#each [11, 16, 21] as x (x)}<line x1={x} y1="27" x2={x - 1.5} y2="30" stroke="#4cc9f0" stroke-width="2" stroke-linecap="round" />{/each}
  {/if}
  {#if art === 'schnee'}
    {#each [11, 16, 21] as x (x)}<circle cx={x} cy="28.5" r="1.4" fill="#e2e8f0" />{/each}
  {/if}
  {#if art === 'gewitter'}<path d="M17 22l-3 5h3l-2 4 5-6h-3l2-3z" fill="#facc15" />{/if}
  {#if art === 'nebel'}
    {#each [26, 29] as y (y)}<line x1="7" y1={y} x2="25" y2={y} stroke="#94a3b8" stroke-width="2" stroke-linecap="round" />{/each}
  {/if}
</svg>
