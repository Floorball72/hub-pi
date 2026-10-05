<script lang="ts">
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import Spielfeld from '../komponenten/Spielfeld.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { datum } from '../lib/format.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Spieler { id: string; nummer: number | null; name: string; position: string | null; aktiv?: boolean }
  interface Spiel { id: string; datum: string; gegner: string; team: string | null; ort: string | null; saison: string | null; resultat: { eigen: number; gegner: number }; schuesse: { eigen: number; gegner: number } }
  interface Ereignis { id: string; typ: string; team: string; x: number; y: number; spieler_id: string | null; assist_id?: string | null; drittel?: number | null; minute?: number | null }
  interface Werte { schuesse: number; tore: number; aufsTor: number; geblockt: number; daneben: number; effizienz: number | null; praezision: number | null }
  interface Auswertung {
    eigen: Werte;
    gegner: Werte;
    zonenEigen: ({ zone: string } & Werte)[];
    zonenGegner: ({ zone: string } & Werte)[];
    drittel: { drittel: number; eigen: Werte; gegner: Werte }[];
    spieler: ({ spieler: Spieler; assists: number; punkte: number; spiele: number; distanz: number | null } & Werte)[];
    spiele: number;
    ereignisse: Ereignis[];
  }

  const TYPEN = [
    { id: 'tor', name: 'Tor' },
    { id: 'gehalten', name: 'Gehalten' },
    { id: 'daneben', name: 'Daneben' },
    { id: 'geblockt', name: 'Geblockt' },
  ];
  const TYP_NAME: Record<string, string> = Object.fromEntries(TYPEN.map((t) => [t.id, t.name]));
  const DRITTEL = [1, 2, 3, 4];
  const drittelName = (d: number) => (d === 4 ? 'V' : `${d}.`);

  let tab = $state('Erfassen');
  let u = $state<{ spiele: Spiel[]; spieler: Spieler[]; saisons: string[] } | null>(null);

  async function uebersichtLaden() {
    u = await api.get('/api/m/analyse/uebersicht');
  }
  // Neu laden beim Tab Wechsel und nach Änderungen in den Editoren für Spiele und Kader
  let spielZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  let spielerZeilen = $state<({ id: string } & Record<string, unknown>)[]>([]);
  $effect(() => {
    void tab;
    void JSON.stringify(spielZeilen);
    void JSON.stringify(spielerZeilen);
    uebersichtLaden().catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const spielerName = (id: string | null | undefined) => {
    const s = u?.spieler.find((x) => x.id === id);
    return s ? `${s.nummer ?? ''} ${s.name}`.trim() : '';
  };
  const kader = $derived((u?.spieler ?? []).filter((s) => s.aktiv !== false && s.position !== 'Torhüter'));

  // ---------- Erfassen ----------
  let spielId = $state<string>(lesen('analyse.spiel', ''));
  let ereignisse = $state<Ereignis[]>([]);
  let team = $state<'eigen' | 'gegner'>('eigen');
  let drittel = $state(1);
  let situation = $state('gleich');
  let minute = $state<number | null>(null);
  let schuetze = $state<string | null>(null);
  let assist = $state<string>('');
  let markierung = $state<{ x: number; y: number } | null>(null);
  let speichert = $state(false);

  $effect(() => {
    if (u && !u.spiele.some((s) => s.id === spielId)) spielId = u.spiele[0]?.id ?? '';
  });
  $effect(() => {
    schreiben('analyse.spiel', spielId);
    if (tab === 'Erfassen' && spielId) spielLaden(spielId);
  });

  async function spielLaden(id: string) {
    const d = await api.get<{ ereignisse: Ereignis[] }>(`/api/m/analyse/spiel/${id}`);
    if (id === spielId) ereignisse = d.ereignisse;
  }

  const stand = $derived({
    eigen: ereignisse.filter((e) => e.team === 'eigen' && e.typ === 'tor').length,
    gegner: ereignisse.filter((e) => e.team === 'gegner' && e.typ === 'tor').length,
  });
  const aktuellesSpiel = $derived(u?.spiele.find((s) => s.id === spielId) ?? null);

  async function erfassen(typ: string) {
    if (!markierung || !spielId || speichert) return;
    speichert = true;
    try {
      const neu = await api.post<Ereignis>('/api/daten/analyse_ereignisse', {
        spiel_id: spielId,
        typ,
        team,
        x: markierung.x,
        y: markierung.y,
        spieler_id: team === 'eigen' ? schuetze : null,
        assist_id: team === 'eigen' && typ === 'tor' && assist ? assist : null,
        drittel,
        minute,
        situation,
      });
      ereignisse = [...ereignisse, neu];
      markierung = null;
      assist = '';
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    } finally {
      speichert = false;
    }
  }

  async function rueckgaengig() {
    const letztes = ereignisse.at(-1);
    if (!letztes) return;
    try {
      await api.del(`/api/daten/analyse_ereignisse/${letztes.id}?bestaetigt=ja`);
      ereignisse = ereignisse.slice(0, -1);
      melden('Letzter Abschluss entfernt', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  // ---------- Auswertung ----------
  let bereich = $state<string>(lesen('analyse.bereich', 'alle'));
  let sicht = $state<'eigen' | 'gegner'>('eigen');
  let nurSpieler = $state('');
  let darstellung = $state<'punkte' | 'heatmap'>('punkte');
  let a = $state<Auswertung | null>(null);

  $effect(() => {
    if (tab !== 'Auswertung' && tab !== 'Spieler') return;
    schreiben('analyse.bereich', bereich);
    const q = new URLSearchParams();
    if (bereich.startsWith('s:')) q.set('saison', bereich.slice(2));
    if (bereich.startsWith('g:')) q.set('spiel', bereich.slice(2));
    if (nurSpieler) q.set('spieler', nurSpieler);
    api
      .get<Auswertung>(`/api/m/analyse/auswertung?${q}`)
      .then((x) => (a = x))
      .catch((e) => melden(fehlerText(e), 'ausfall'));
  });

  const sichtbar = $derived((a?.ereignisse ?? []).filter((e) => (nurSpieler ? true : e.team === sicht)));
  const w = $derived(a ? (sicht === 'eigen' ? a.eigen : a.gegner) : null);
  const zonen = $derived(a ? (sicht === 'eigen' ? a.zonenEigen : a.zonenGegner) : []);
  const pct = (n: number | null) => (n === null ? '–' : `${n} %`);

  function spielOeffnen(id: string) {
    spielId = id;
    tab = 'Erfassen';
  }
</script>

{#snippet bereichWahl()}
  <select bind:value={bereich} aria-label="Spiele">
    <option value="alle">Alle Spiele</option>
    {#each u?.saisons ?? [] as s (s)}<option value={`s:${s}`}>Saison {s}</option>{/each}
    {#each u?.spiele ?? [] as s (s.id)}<option value={`g:${s.id}`}>{datum(s.datum)} gegen {s.gegner}</option>{/each}
  </select>
{/snippet}

<ModulRahmen modulId="analyse" tabs={['Erfassen', 'Auswertung', 'Spieler', 'Spiele']} bind:tab>
  {#if !u}
    <div class="laedt" style="height:320px"></div>
  {:else if tab === 'Erfassen'}
    {#if !u.spiele.length}
      <p class="leer">Noch kein Spiel. Unter «Spiele» ein Spiel anlegen, unter «Spieler» den Kader.</p>
      <button class="primaer" onclick={() => (tab = 'Spiele')}>Spiel anlegen</button>
    {:else}
      <div class="erfassen">
        <div class="stapel">
          <div class="panel stapel">
            <div class="zeile-zwischen">
              <select bind:value={spielId} aria-label="Spiel">
                {#each u.spiele as s (s.id)}<option value={s.id}>{datum(s.datum)} gegen {s.gegner}</option>{/each}
              </select>
              <div class="stand zahl">{stand.eigen}<span class="gedaempft">:</span>{stand.gegner}</div>
            </div>
            {#if aktuellesSpiel}<div class="sehr-klein gedaempft">{aktuellesSpiel.team ?? 'Wir'} · {aktuellesSpiel.ort === 'auswaerts' ? 'auswärts' : 'heim'} · {ereignisse.length} Abschlüsse erfasst</div>{/if}
            <div class="wahl">
              <button class:an={team === 'eigen'} onclick={() => (team = 'eigen')}>Wir schiessen</button>
              <button class:an={team === 'gegner'} onclick={() => (team = 'gegner')}>Gegner schiesst</button>
            </div>
            <div class="zeile">
              <span class="klein gedaempft">Drittel</span>
              <div class="wahl">
                {#each DRITTEL as d (d)}<button class:an={drittel === d} onclick={() => (drittel = d)}>{drittelName(d)}</button>{/each}
              </div>
              <input type="number" min="0" max="80" placeholder="Min" bind:value={minute} class="minute" aria-label="Minute" />
              <select bind:value={situation} aria-label="Situation">
                <option value="gleich">5 gegen 5</option>
                <option value="ueberzahl">Überzahl</option>
                <option value="unterzahl">Unterzahl</option>
                <option value="penalty">Penalty</option>
              </select>
            </div>
            {#if team === 'eigen'}
              <div>
                <div class="klein gedaempft">Schütze</div>
                <div class="chips">
                  <button class:an={schuetze === null} onclick={() => (schuetze = null)}>?</button>
                  {#each kader as s (s.id)}
                    <button class:an={schuetze === s.id} onclick={() => (schuetze = s.id)}>{s.nummer ?? ''} {s.name}</button>
                  {/each}
                </div>
                {#if !kader.length}<p class="sehr-klein gedaempft">Kader unter «Spieler» erfassen.</p>{/if}
              </div>
              <label class="klein">
                Assist bei Tor
                <select bind:value={assist}>
                  <option value="">keiner</option>
                  {#each kader.filter((s) => s.id !== schuetze) as s (s.id)}<option value={s.id}>{s.nummer ?? ''} {s.name}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
        </div>
        <div class="stapel">
          <Spielfeld punkte={ereignisse.filter((e) => e.team === team)} {markierung} ontipp={(x, y) => (markierung = { x, y })} />
          <div class="ausgang">
            {#each TYPEN as t (t.id)}
              <button class="ausgang-{t.id}" disabled={!markierung || speichert} onclick={() => erfassen(t.id)}>{t.name}</button>
            {/each}
          </div>
          <p class="sehr-klein gedaempft">{markierung ? 'Ausgang wählen, dann ist der Abschluss gespeichert.' : 'Auf das Feld tippen, wo der Abschluss war. Das Tor ist oben.'}</p>
          {#if ereignisse.length}
            <div class="panel">
              <div class="zeile-zwischen">
                <h3>Zuletzt</h3>
                <button class="leise klein" onclick={rueckgaengig}>Letzten entfernen</button>
              </div>
              <ul class="liste">
                {#each ereignisse.slice(-5).reverse() as e (e.id)}
                  <li class="zeile klein">
                    <span class="marke {e.typ === 'tor' ? 'ok' : ''}">{TYP_NAME[e.typ]}</span>
                    <span class="wachsen">{e.team === 'eigen' ? spielerName(e.spieler_id) || 'Wir' : 'Gegner'}{e.assist_id ? ` (Assist ${spielerName(e.assist_id)})` : ''}</span>
                    <span class="sehr-klein gedaempft">{e.drittel ? drittelName(e.drittel) : ''}{e.minute != null ? ` ${e.minute}'` : ''}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else if tab === 'Auswertung'}
    <div class="zeile filter">
      {@render bereichWahl()}
      <div class="wahl">
        <button class:an={sicht === 'eigen' && !nurSpieler} onclick={() => ((sicht = 'eigen'), (nurSpieler = ''))}>Unsere Abschlüsse</button>
        <button class:an={sicht === 'gegner' && !nurSpieler} onclick={() => ((sicht = 'gegner'), (nurSpieler = ''))}>Gegen uns</button>
      </div>
      <select bind:value={nurSpieler} aria-label="Spieler">
        <option value="">Alle Spieler</option>
        {#each u.spieler as s (s.id)}<option value={s.id}>{s.nummer ?? ''} {s.name}</option>{/each}
      </select>
      <div class="wahl">
        <button class:an={darstellung === 'punkte'} onclick={() => (darstellung = 'punkte')}>Punkte</button>
        <button class:an={darstellung === 'heatmap'} onclick={() => (darstellung = 'heatmap')}>Heatmap</button>
      </div>
    </div>
    {#if !a || !w}
      <div class="laedt" style="height:300px"></div>
    {:else}
      <div class="erfassen">
        <div class="stapel">
          <Spielfeld punkte={sichtbar} heatmap={darstellung === 'heatmap'} zonen farbe={sicht === 'gegner' && !nurSpieler ? 'var(--ausfall)' : 'var(--akzent)'} />
          <div class="legende sehr-klein gedaempft">
            <span><i class="l tor"></i>Tor</span><span><i class="l gehalten"></i>Gehalten</span><span><i class="l daneben"></i>Daneben</span><span><i class="l geblockt"></i>Geblockt</span>
          </div>
        </div>
        <div class="stapel">
          <div class="kennzahlen">
            <div class="panel"><div class="sehr-klein gedaempft">Schüsse</div><div class="zahl gross">{w.schuesse}</div><div class="sehr-klein gedaempft">{a.spiele} Spiele</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Tore</div><div class="zahl gross">{w.tore}</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Effizienz</div><div class="zahl gross">{pct(w.effizienz)}</div><div class="sehr-klein gedaempft">Tore pro Schuss</div></div>
            <div class="panel"><div class="sehr-klein gedaempft">Aufs Tor</div><div class="zahl gross">{pct(w.praezision)}</div><div class="sehr-klein gedaempft">{w.geblockt} geblockt, {w.daneben} daneben</div></div>
          </div>
          <div class="panel">
            <h3>Zonen {sicht === 'gegner' ? 'gegen uns' : ''}</h3>
            <table>
              <thead><tr><th>Zone</th><th>Schüsse</th><th>Tore</th><th>Effizienz</th></tr></thead>
              <tbody>
                {#each zonen as z (z.zone)}<tr><td>{z.zone}</td><td class="zahl">{z.schuesse}</td><td class="zahl">{z.tore}</td><td class="zahl">{pct(z.effizienz)}</td></tr>{/each}
              </tbody>
            </table>
            <p class="sehr-klein gedaempft">Torraum bis 5 m vom Tor, Slot zentral bis 10 m, Seite seitlich bis 10 m, Distanz weiter weg.</p>
          </div>
          <div class="panel">
            <h3>Nach Drittel</h3>
            <table>
              <thead><tr><th></th><th>Schüsse</th><th>Tore</th><th>Gegen uns</th><th>Gegentore</th></tr></thead>
              <tbody>
                {#each a.drittel as d (d.drittel)}<tr><td>{d.drittel === 4 ? 'Verl.' : `${d.drittel}. Drittel`}</td><td class="zahl">{d.eigen.schuesse}</td><td class="zahl">{d.eigen.tore}</td><td class="zahl">{d.gegner.schuesse}</td><td class="zahl">{d.gegner.tore}</td></tr>{/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    {/if}
  {:else if tab === 'Spieler'}
    <div class="zeile filter">{@render bereichWahl()}</div>
    <div class="panel tabelle-scroll">
      {#if a?.spieler.length}
        <table>
          <thead><tr><th>Nr</th><th>Spieler</th><th>Sp</th><th>Tore</th><th>Ass</th><th>Pkt</th><th>Schüsse</th><th>Effizienz</th><th>Aufs Tor</th><th>Distanz</th></tr></thead>
          <tbody>
            {#each a.spieler as s (s.spieler.id)}
              <tr>
                <td>{s.spieler.nummer ?? ''}</td><td>{s.spieler.name}</td><td class="zahl">{s.spiele}</td><td class="zahl">{s.tore}</td><td class="zahl">{s.assists}</td>
                <td class="zahl"><strong>{s.punkte}</strong></td><td class="zahl">{s.schuesse}</td><td class="zahl">{pct(s.effizienz)}</td><td class="zahl">{pct(s.praezision)}</td>
                <td class="zahl">{s.distanz != null ? `${s.distanz} m` : '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="leer">Noch keine Abschlüsse mit Spielern erfasst.</p>{/if}
    </div>
    <h3 style="margin-top:18px">Kader</h3>
    <p class="sehr-klein gedaempft">Nur Nummer und Vorname oder Kürzel erfassen, keine weiteren Angaben.</p>
    <div class="panel"><TabellenEditor tabelle="analyse_spieler" spalten={['nummer', 'name', 'position', 'aktiv']} sort="nummer" neuText="Spieler" bind:zeilen={spielerZeilen} /></div>
  {:else}
    <div class="panel">
      <ul class="liste">
        {#each u.spiele as s (s.id)}
          <li class="zeile spiel">
            <span class="sehr-klein gedaempft datum">{datum(s.datum, true)}</span>
            <span class="wachsen">gegen {s.gegner}</span>
            <span class="sehr-klein gedaempft">{s.schuesse.eigen}:{s.schuesse.gegner} Schüsse</span>
            <strong class="zahl">{s.resultat.eigen}:{s.resultat.gegner}</strong>
            <button class="leise klein" onclick={() => spielOeffnen(s.id)}>Erfassen</button>
          </li>
        {:else}<li class="leer">Noch keine Spiele.</li>{/each}
      </ul>
    </div>
    <h3 style="margin-top:18px">Spiele verwalten</h3>
    <div class="panel"><TabellenEditor tabelle="analyse_spiele" spalten={['datum', 'gegner', 'team', 'ort', 'saison']} sort="-datum" neuText="Spiel" bind:zeilen={spielZeilen} /></div>
  {/if}
</ModulRahmen>

<style>
  .erfassen {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 800px) {
    .erfassen {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .stand {
    font-size: 2rem;
    font-weight: 700;
  }
  .wahl {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .wahl button,
  .chips button {
    background: var(--flaeche-2);
  }
  .wahl button.an,
  .chips button.an {
    background: #4cc9f026;
    border-color: var(--akzent);
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .minute {
    width: 72px;
  }
  .ausgang {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .ausgang button {
    min-height: 48px;
    font-weight: 600;
  }
  .ausgang-tor:not(:disabled) {
    background: #34d39926;
    border-color: var(--ok);
  }
  .filter {
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .filter select {
    width: auto;
    flex: 1 1 160px;
    max-width: 260px;
  }
  .kennzahlen {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }
  .gross {
    font-size: 1.6rem;
  }
  .legende {
    display: flex;
    gap: 14px;
    justify-content: center;
  }
  .l {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 5px;
  }
  .l.tor {
    background: var(--ok);
  }
  .l.gehalten {
    background: var(--akzent);
  }
  .l.daneben {
    border: 1.5px solid var(--text-2);
  }
  .l.geblockt {
    background: var(--warnung);
  }
  .spiel {
    gap: 10px;
    padding: 6px 0;
  }
  .datum {
    width: 90px;
    flex: none;
  }
</style>
