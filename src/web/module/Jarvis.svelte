<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import ModulRahmen from '../komponenten/ModulRahmen.svelte';
  import TabellenEditor from '../komponenten/TabellenEditor.svelte';
  import { api, fehlerText } from '../lib/api.ts';
  import { bestaetigen } from '../lib/bestaetigen.svelte.ts';
  import { type JarvisEreignis, jarvisChat } from '../lib/jarvisChat.ts';
  import { melden } from '../lib/meldung.svelte.ts';
  import { navigieren } from '../lib/router.svelte.ts';
  import { lesen, schreiben } from '../lib/speicher.ts';

  interface Status {
    schluessel: boolean;
    anbieter?: string;
    demo: boolean;
    modell: string;
    vollmacht: string;
    tokensHeute: number;
    tageslimit: number;
    erinnerungen: number;
    werkzeuge: number;
  }
  interface Einstellung {
    vollmacht: string;
    tageslimit: number;
    persoenlichkeit: string;
    modell: 'standard' | 'schnell';
    web: boolean;
    morgenpush: boolean;
    vollmachten?: string[];
    persoenlichkeiten?: string[];
  }
  interface Gespraech { id: string; titel: string }
  interface Schritt {
    id: string;
    name: string;
    beschreibung: string;
    ok?: boolean;
    kurz?: string;
    bestaetigung?: string;
    entschieden?: string;
  }
  interface Eintrag { rolle: 'user' | 'assistant'; text: string; schritte: Schritt[]; laeuft?: boolean }

  const VOLLMACHT_NAMEN: Record<string, string> = {
    nur_lesen: 'Nur lesen',
    fragen: 'Alles fragen',
    autonom: 'Autonom',
    voll: 'Voll',
  };
  const VOLLMACHT_HILFE: Record<string, string> = {
    nur_lesen: 'Jarvis schaut nach und merkt sich Dinge, ändert aber nichts.',
    fragen: 'Jede Änderung muss bestätigt werden.',
    autonom: 'Jarvis erledigt Anlegen und Ändern selbst. Löschen, Module schalten, Neustart und Update bestätigst du.',
    voll: 'Jarvis führt alles ohne Rückfrage aus. Nur für Vertrauensmenschen und eigene Netze.',
  };
  const PERS_NAMEN: Record<string, string> = { butler: 'Butler', sachlich: 'Sachlich', locker: 'Locker' };
  const VORSCHLAEGE = [
    'Was steht heute an?',
    'Gib mir das Briefing',
    'Wie geht es dem Pi?',
    'Merk dir: ',
    'Welche Rechnungen sind bald fällig?',
  ];

  let tab = $state('Jarvis');
  let status = $state<Status | null>(null);
  let einst = $state<Einstellung | null>(null);
  let gespraeche = $state<Gespraech[]>([]);
  let gespraechId = $state<string | undefined>(undefined);
  let eintraege = $state<Eintrag[]>([]);
  let eingabe = $state('');
  let laeuft = $state(false);
  let zustand = $state<'ruhe' | 'hoert' | 'denkt' | 'spricht'>('ruhe');
  let verlaufEl = $state<HTMLDivElement | null>(null);
  let abbruch: AbortController | null = null;

  // Sprache
  const SR: any = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
  const spracheOk = !!SR && 'speechSynthesis' in globalThis;
  let weckwort = $state(lesen('jarvis.weckwort', false));
  let vorlesen = $state(lesen('jarvis.vorlesen', false));
  let diktat = $state(false);
  let zuhoerer: any = null;
  let hoertZu = false;
  let sprichtGerade = $state(false);
  let zwischen = $state('');

  const WECK = /\b(?:hey|hallo|hi|ok|okay)[\s,.!]*(?:jarvis|dscharvis|jarvis's)\b[\s,.!:]*/i;

  const ANBIETER_NAMEN: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', groq: 'Groq' };
  const anbieterName = $derived(ANBIETER_NAMEN[status?.anbieter ?? ''] ?? 'Jarvis');
  const gruss = (() => {
    const h = Number(new Intl.DateTimeFormat('de-CH', { hour: 'numeric', hour12: false, timeZone: 'Europe/Zurich' }).format(new Date()));
    return h < 5 ? 'Noch wach, Jerome?' : h < 11 ? 'Guten Morgen, Jerome' : h < 17 ? 'Guten Tag, Jerome' : 'Guten Abend, Jerome';
  })();

  const prozent = $derived(status ? Math.min(100, Math.round((status.tokensHeute / status.tageslimit) * 100)) : 0);

  async function ladenStatus() {
    try {
      status = await api.get<Status>('/api/m/jarvis/status');
      einst = await api.get<Einstellung>('/api/m/jarvis/einstellungen');
      gespraeche = await api.get<Gespraech[]>('/api/m/jarvis/gespraeche');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  async function scrollen() {
    await tick();
    verlaufEl?.scrollTo({ top: verlaufEl.scrollHeight, behavior: 'smooth' });
  }

  async function oeffnen(id: string) {
    try {
      const z = await api.get<{ rolle: 'user' | 'assistant'; text: string; werkzeuge: string[] }[]>(
        `/api/m/jarvis/gespraeche/${id}`,
      );
      gespraechId = id;
      eintraege = z.map((m) => ({
        rolle: m.rolle,
        text: m.text,
        schritte: (m.werkzeuge ?? []).map((n, i) => ({ id: `${id}-${i}`, name: String(n), beschreibung: String(n), ok: true })),
      }));
      tab = 'Jarvis';
      scrollen();
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  function neu() {
    gespraechId = undefined;
    eintraege = [];
  }

  async function loeschen(g: Gespraech) {
    if (!(await bestaetigen('Gespräch löschen', `«${g.titel}» wird gelöscht.`, 'Löschen', true))) return;
    try {
      await api.del(`/api/m/jarvis/gespraeche/${g.id}?bestaetigt=ja`);
      if (gespraechId === g.id) neu();
      gespraeche = gespraeche.filter((x) => x.id !== g.id);
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  /** Markdown Zeichen entfernen, damit das Vorlesen sauber klingt. */
  function fuerSprache(t: string) {
    return t.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  }

  function sprechen(text: string) {
    if (!vorlesen || !spracheOk || !text.trim()) {
      zustand = 'ruhe';
      return;
    }
    const u = new SpeechSynthesisUtterance(fuerSprache(text));
    u.lang = 'de-CH';
    const stimmen = speechSynthesis.getVoices();
    const stimme = stimmen.find((s) => s.lang === 'de-CH') ?? stimmen.find((s) => s.lang.startsWith('de'));
    if (stimme) u.voice = stimme;
    u.rate = 1.03;
    u.onstart = () => {
      sprichtGerade = true;
      zustand = 'spricht';
      zuhoerenPausieren();
    };
    const ende = () => {
      sprichtGerade = false;
      zustand = 'ruhe';
      zuhoerenStarten();
    };
    u.onend = ende;
    u.onerror = ende;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function stumm() {
    if (spracheOk) speechSynthesis.cancel();
    sprichtGerade = false;
    if (zustand === 'spricht') zustand = 'ruhe';
  }

  async function senden(text = eingabe) {
    const t = text.trim();
    if (!t || laeuft) return;
    stumm();
    eingabe = '';
    laeuft = true;
    zustand = 'denkt';
    eintraege.push({ rolle: 'user', text: t, schritte: [] });
    const antwort: Eintrag = $state({ rolle: 'assistant', text: '', schritte: [], laeuft: true });
    eintraege.push(antwort);
    scrollen();
    abbruch = new AbortController();
    let ziel = '';
    try {
      await jarvisChat(t, gespraechId, abbruch.signal, (e) => {
        if (e.art === 'navigation') ziel = String(e.ziel);
        else ereignis(antwort, e);
      });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') antwort.text ||= `Das hat nicht geklappt: ${fehlerText(e)}`;
    } finally {
      antwort.laeuft = false;
      laeuft = false;
      abbruch = null;
      if (zustand === 'denkt') zustand = 'ruhe';
      sprechen(antwort.text);
      if (ziel) navigieren(ziel);
      api.get<Status>('/api/m/jarvis/status').then((s) => (status = s)).catch(() => undefined);
      api.get<Gespraech[]>('/api/m/jarvis/gespraeche').then((g) => (gespraeche = g)).catch(() => undefined);
    }
  }

  function ereignis(a: Eintrag, e: JarvisEreignis & Record<string, any>) {
    if (e.art === 'gespraech') gespraechId = e.id;
    else if (e.art === 'text') a.text += e.text;
    else if (e.art === 'werkzeug') a.schritte.push({ id: e.id, name: e.name, beschreibung: e.beschreibung });
    else if (e.art === 'ergebnis') {
      const s = a.schritte.find((x) => x.id === e.id);
      if (s) {
        s.ok = e.ok;
        s.kurz = e.kurz;
      }
    } else if (e.art === 'bestaetigung') {
      const s = [...a.schritte].reverse().find((x) => x.name === e.werkzeug && !x.bestaetigung);
      if (s) s.bestaetigung = e.id;
    } else if (e.art === 'fehler') a.text += (a.text ? '\n' : '') + e.text;
  }

  async function entscheiden(s: Schritt, ja: boolean) {
    if (!s.bestaetigung) return;
    const id = s.bestaetigung;
    try {
      const r = await api.post<{ ok: boolean; text: string }>('/api/m/jarvis/bestaetigen', { id, ja });
      s.entschieden = ja ? (r.ok ? 'Ausgeführt' : 'Fehlgeschlagen') : 'Verworfen';
      s.kurz = r.text.slice(0, 160);
      s.bestaetigung = undefined;
      if (ja && r.ok) melden('Erledigt', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  function stoppen() {
    abbruch?.abort();
  }

  // Spracherkennung mit Weckwort. Die Seite muss offen sein, der Browser fragt einmal nach dem Mikrofon.
  function zuhoerenStarten() {
    if (!spracheOk || (!weckwort && !diktat) || hoertZu || sprichtGerade || laeuft) return;
    zuhoerer ??= (() => {
      const z = new SR();
      z.lang = 'de-CH';
      z.continuous = true;
      z.interimResults = true;
      z.onresult = (ev: any) => {
        let fest = '';
        let vorlaeufig = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) fest += r[0].transcript;
          else vorlaeufig += r[0].transcript;
        }
        zwischen = vorlaeufig;
        if (!fest.trim()) return;
        zwischen = '';
        if (diktat) {
          diktat = false;
          zuhoerenPausieren();
          senden(fest);
          return;
        }
        const m = fest.match(WECK);
        if (!m) return;
        const befehl = fest.slice((m.index ?? 0) + m[0].length).trim();
        if (befehl) senden(befehl);
        else {
          diktat = true;
          zustand = 'hoert';
        }
      };
      z.onstart = () => {
        hoertZu = true;
        if (zustand === 'ruhe') zustand = weckwort || diktat ? 'hoert' : 'ruhe';
      };
      z.onend = () => {
        hoertZu = false;
        if (zustand === 'hoert' && !diktat) zustand = 'ruhe';
        if (weckwort || diktat) setTimeout(zuhoerenStarten, 400);
      };
      z.onerror = (ev: any) => {
        const grund: Record<string, string> = {
          'not-allowed': globalThis.isSecureContext
            ? 'Der Browser blockiert das Mikrofon. Tippe in der Adressleiste auf das Schloss und erlaube das Mikrofon für diese Seite.'
            : 'Das Mikrofon geht nur über HTTPS. Öffne den Hub über die Tailscale Adresse (https://…ts.net), nicht über http oder die IP.',
          'service-not-allowed': 'Dieser Browser bietet keine Spracherkennung an. Nutze Chrome oder Edge, in Brave und in der App geht es nicht.',
          'audio-capture': 'Es wurde kein Mikrofon gefunden. Prüfe, ob eines angeschlossen und freigegeben ist.',
          network: 'Die Spracherkennung des Browsers ist nicht erreichbar. Sie braucht eine Internetverbindung.',
        };
        if (ev.error in grund) {
          weckwort = false;
          diktat = false;
          schreiben('jarvis.weckwort', false);
          melden(grund[ev.error], 'ausfall');
        }
      };
      return z;
    })();
    try {
      zuhoerer.start();
    } catch {
      // läuft bereits
    }
  }

  function zuhoerenPausieren() {
    try {
      zuhoerer?.stop();
    } catch {
      // egal
    }
    hoertZu = false;
  }

  function weckwortSchalten() {
    weckwort = !weckwort;
    schreiben('jarvis.weckwort', weckwort);
    if (weckwort) zuhoerenStarten();
    else if (!diktat) zuhoerenPausieren();
  }

  function mikro() {
    if (!spracheOk) return melden('Dieser Browser kann keine Spracherkennung. Chrome oder Safari probieren.', 'info');
    stumm();
    diktat = !diktat;
    if (diktat) {
      zustand = 'hoert';
      zuhoerenPausieren();
      setTimeout(zuhoerenStarten, 150);
    } else {
      zustand = 'ruhe';
      if (!weckwort) zuhoerenPausieren();
    }
  }

  function vorlesenSchalten() {
    vorlesen = !vorlesen;
    schreiben('jarvis.vorlesen', vorlesen);
    if (!vorlesen) stumm();
  }

  async function speichern(teil: Partial<Einstellung>) {
    try {
      einst = await api.put<Einstellung>('/api/m/jarvis/einstellungen', teil);
      status = await api.get<Status>('/api/m/jarvis/status');
      melden('Gespeichert', 'ok');
    } catch (e) {
      melden(fehlerText(e), 'ausfall');
    }
  }

  let kacheln = $state<Record<string, any>>({});
  async function ladenKacheln() {
    try {
      const s = await api.get<{ kacheln?: Record<string, any> }>('/api/start');
      kacheln = s.kacheln ?? {};
    } catch {
      // HUD bleibt ohne Kacheln
    }
  }
  const kachelListe = $derived(
    Object.entries(kacheln)
      .filter(([k]) => k !== 'jarvis')
      .slice(0, 6),
  );

  let erinnerungen = $state<any[]>([]);

  onMount(() => {
    ladenStatus();
    ladenKacheln();
    if (spracheOk) speechSynthesis.getVoices();
    if (weckwort) zuhoerenStarten();
  });
  onDestroy(() => {
    weckwort = false;
    diktat = false;
    zuhoerenPausieren();
    if (spracheOk) speechSynthesis.cancel();
    abbruch?.abort();
  });
</script>

<ModulRahmen modulId="jarvis" tabs={['Jarvis', 'Gedächtnis', 'Einstellungen']} bind:tab>
  {#if tab === 'Jarvis'}
    <div class="jarvis">
      <aside class="hud" aria-label="Jarvis Anzeige">
        <div class="orb {zustand}" aria-hidden="true">
          <span class="halo"></span>
          <span class="ring r1"></span>
          <span class="ring r2"></span>
          <span class="ring r3"></span>
          <span class="kugel"></span>
        </div>
        <div class="titel">Jarvis</div>
        <div class="zustand" aria-live="polite">
          <span class="led {zustand}"></span>
          {#if zustand === 'hoert'}Ich höre zu{:else if zustand === 'denkt'}Ich überlege{:else if zustand === 'spricht'}Ich spreche{:else if status && !status.schluessel && !status.demo}Kein API Schlüssel{:else if weckwort}Wartet auf «Hey Jarvis»{:else}Bereit{/if}
        </div>
        <div class="wellen" class:aktiv={zustand === 'hoert' || zustand === 'spricht'} aria-hidden="true">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        {#if zwischen}<em class="zwischen">{zwischen}</em>{/if}
        {#if status}
          <div class="zahlen">
            <div class="zahl breit" title="Tokens heute im Verhältnis zum Tageslimit">
              <span class="bez">Tageslimit</span>
              <span class="wert">{prozent}%</span>
              <i class="balken"><b style="width:{prozent}%"></b></i>
            </div>
            <div class="zahl">
              <span class="bez">Gedächtnis</span>
              <span class="wert">{status.erinnerungen}</span>
            </div>
            <div class="zahl">
              <span class="bez">Vollmacht</span>
              <span class="wert klein">{VOLLMACHT_NAMEN[status.vollmacht] ?? status.vollmacht}</span>
            </div>
          </div>
          <div class="modell" title="Aktives Sprachmodell">
            {#if status.demo}<span class="demo">Demo</span>{:else}{anbieterName}{/if}
            <span class="trenner">·</span>{status.modell}
          </div>
        {/if}
        {#if kachelListe.length}
          <div class="kacheln">
            {#each kachelListe as [id, k]}
              <span class="kachel" title={id}>{k.titel ?? id} <b>{k.wert ?? ''}</b></span>
            {/each}
          </div>
        {/if}
      </aside>

      <section class="chat" aria-label="Gespräch">
        <header class="kopf">
          <select
            aria-label="Gespräch wählen"
            value={gespraechId ?? ''}
            onchange={(e) => (e.currentTarget.value ? oeffnen(e.currentTarget.value) : neu())}
          >
            <option value="">Neues Gespräch</option>
            {#each gespraeche as g}<option value={g.id}>{g.titel}</option>{/each}
          </select>
          {#if gespraechId}
            {@const g = gespraeche.find((x) => x.id === gespraechId)}
            <button class="leise" onclick={neu}>Neu</button>
            {#if g}<button class="leise" onclick={() => loeschen(g)} aria-label="Gespräch löschen">Löschen</button>{/if}
          {/if}
        </header>

        <div class="verlauf" bind:this={verlaufEl} aria-live="polite">
          {#if !eintraege.length}
            <div class="leer">
              <h2>{gruss}</h2>
              <p>Was kann ich für dich tun? Ich sehe alle Daten im Hub und merke mir, was wichtig ist.</p>
              <div class="vorschlaege">
                {#each VORSCHLAEGE as v}
                  <button class="karte" onclick={() => (v.endsWith(': ') ? (eingabe = v) : senden(v))}>
                    <span class="pfeil" aria-hidden="true">↗</span>{v}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          {#each eintraege as e}
            <div class="zeile {e.rolle}">
              {#if e.rolle === 'assistant'}<span class="avatar" class:denkt={e.laeuft} aria-hidden="true"></span>{/if}
              <div class="blase {e.rolle}">
                {#if e.schritte.length}
                  <div class="schritte">
                    {#each e.schritte as s}
                      <div class="schritt" class:fehler={s.ok === false} class:wartet={s.ok === undefined || !!s.bestaetigung}>
                        <span class="punkt"></span>
                        <span class="sname">{s.beschreibung}</span>
                        {#if s.entschieden}<span class="ende">{s.entschieden}</span>{/if}
                        {#if s.bestaetigung}
                          <span class="aktionen">
                            <button class="primaer" onclick={() => entscheiden(s, true)}>Ausführen</button>
                            <button onclick={() => entscheiden(s, false)}>Verwerfen</button>
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if e.text}<p>{e.text}</p>{:else if e.laeuft && !e.schritte.length}<p class="tippt"><i></i><i></i><i></i></p>{/if}
              </div>
            </div>
          {/each}
        </div>

        <form class="eingabe" onsubmit={(ev) => { ev.preventDefault(); senden(); }}>
          <button type="button" class="mikro" class:an={diktat} onclick={mikro} aria-label="Sprechen" title="Sprechen">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
          <input
            class="wachsen"
            bind:value={eingabe}
            placeholder="Nachricht an Jarvis"
            maxlength="4000"
            aria-label="Nachricht an Jarvis"
            autocomplete="off"
            disabled={laeuft}
          />
          {#if laeuft}
            <button type="button" class="los stopp" onclick={stoppen} aria-label="Stopp" title="Stopp">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          {:else}
            <button class="los" disabled={!eingabe.trim()} aria-label="Senden" title="Senden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          {/if}
        </form>
        <div class="leiste">
          <label class="tog" class:an={vorlesen}>
            <input type="checkbox" checked={vorlesen} onchange={vorlesenSchalten} disabled={!spracheOk} />
            <span class="knauf"></span>Antworten vorlesen
          </label>
          <label class="tog" class:an={weckwort}>
            <input type="checkbox" checked={weckwort} onchange={weckwortSchalten} disabled={!spracheOk} />
            <span class="knauf"></span>Weckwort «Hey Jarvis»
          </label>
          {#if sprichtGerade}<button class="leise" onclick={stumm}>Stumm</button>{/if}
        </div>
        {#if weckwort}
          <p class="hinweis">Das Weckwort funktioniert, solange diese Seite offen ist. Dafür braucht der Browser das Mikrofon und eine HTTPS Adresse.</p>
        {/if}
      </section>
    </div>
  {:else if tab === 'Gedächtnis'}
    <div class="stapel">
      <p class="hinweis">Das ist das zweite Gehirn von Jarvis. Er ergänzt es selbst, du kannst Erinnerungen hier prüfen, ändern oder löschen. Wichtigkeit 1 bis 5, höhere kommen immer ins Profil.</p>
      <TabellenEditor tabelle="jarvis_gedaechtnis" spalten={['kategorie', 'inhalt', 'wichtigkeit', 'quelle']} sort="-wichtigkeit" neuText="Erinnerung" bind:zeilen={erinnerungen} />
    </div>
  {:else}
    <div class="stapel">
      {#if !einst || !status}
        <div class="laedt">Lädt …</div>
      {:else}
        {#if !status.schluessel && !status.demo}
          <div class="panel warnung">
            Es ist noch kein Schlüssel hinterlegt. Trage <code>GEMINI_API_KEY</code> (gratis), <code>GROQ_API_KEY</code> (gratis) oder <code>ANTHROPIC_API_KEY</code> in die <code>.env</code> auf dem Pi ein und starte den Hub neu.
          </div>
        {/if}
        <div class="panel form">
          <h3>Vollmacht</h3>
          <div class="optionen">
            {#each einst.vollmachten ?? [] as v}
              <label class="option" class:gewaehlt={einst.vollmacht === v}>
                <input type="radio" name="vollmacht" checked={einst.vollmacht === v} onchange={() => speichern({ vollmacht: v })} />
                <strong>{VOLLMACHT_NAMEN[v] ?? v}</strong>
                <span>{VOLLMACHT_HILFE[v] ?? ''}</span>
              </label>
            {/each}
          </div>
        </div>
        <div class="panel form">
          <h3>Verhalten</h3>
          <label>
            Persönlichkeit
            <select value={einst.persoenlichkeit} onchange={(e) => speichern({ persoenlichkeit: e.currentTarget.value })}>
              {#each einst.persoenlichkeiten ?? [] as p}<option value={p}>{PERS_NAMEN[p] ?? p}</option>{/each}
            </select>
          </label>
          <label>
            Modell
            <select value={einst.modell} onchange={(e) => speichern({ modell: e.currentTarget.value as 'standard' | 'schnell' })}>
              <option value="standard">Standard (klüger)</option>
              <option value="schnell">Schnell (günstiger)</option>
            </select>
          </label>
          <label>
            Tageslimit in Tokens
            <input type="number" min="10000" step="10000" value={einst.tageslimit} onchange={(e) => speichern({ tageslimit: Number(e.currentTarget.value) })} />
          </label>
          <label class="schalter">
            <input type="checkbox" checked={einst.web} onchange={(e) => speichern({ web: e.currentTarget.checked })} />
            Jarvis darf Webseiten lesen und im Web suchen
          </label>
          <label class="schalter">
            <input type="checkbox" checked={einst.morgenpush} onchange={(e) => speichern({ morgenpush: e.currentTarget.checked })} />
            Morgenbericht als Push um 07:10 Uhr
          </label>
        </div>
        <div class="panel form">
          <h3>Stand</h3>
          <p class="hinweis">Modell {status.modell}. {status.werkzeuge} Werkzeuge. Heute {status.tokensHeute.toLocaleString('de-CH')} von {status.tageslimit.toLocaleString('de-CH')} Tokens.</p>
        </div>
      {/if}
    </div>
  {/if}
</ModulRahmen>

<style>
  .jarvis {
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 900px) {
    .jarvis {
      grid-template-columns: 320px minmax(0, 1fr);
      align-items: start;
    }
    .hud {
      position: sticky;
      top: 12px;
    }
  }
  @media (max-width: 899px) {
    .hud {
      grid-template-columns: auto minmax(0, 1fr);
      justify-items: start;
      text-align: left;
      align-items: center;
      column-gap: 16px;
      padding: 16px;
    }
    .hud .orb {
      grid-row: 1 / span 3;
      width: 112px;
      height: 112px;
      margin: 0;
    }
    .hud .kugel {
      width: 50px;
      height: 50px;
    }
    .hud .titel {
      font-size: 1.15rem;
    }
    .hud .zwischen,
    .hud .zahlen,
    .hud .modell,
    .hud .kacheln {
      grid-column: 1 / -1;
    }
    .hud .zahlen {
      grid-template-columns: repeat(3, 1fr);
    }
    .hud .zahl.breit {
      grid-column: auto;
    }
    .hud .kacheln {
      justify-content: flex-start;
    }
    .chat {
      min-height: 56vh;
    }
  }
  .panel {
    background: var(--flaeche);
    border: 1px solid var(--rand);
    border-radius: var(--radius);
    padding: 14px;
  }

  /* Anzeige */
  .hud {
    position: relative;
    overflow: hidden;
    display: grid;
    gap: 10px;
    justify-items: center;
    text-align: center;
    padding: 26px 18px 20px;
    border: 1px solid color-mix(in srgb, var(--akzent) 22%, var(--rand));
    border-radius: 22px;
    background:
      radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--akzent) 16%, transparent), transparent 70%),
      linear-gradient(180deg, color-mix(in srgb, var(--flaeche-2) 90%, var(--akzent)), var(--flaeche));
    box-shadow: var(--schatten), 0 0 60px -30px var(--akzent);
  }
  .hud::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(#ffffff08 1px, transparent 1px), linear-gradient(90deg, #ffffff08 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: radial-gradient(70% 60% at 50% 25%, #000, transparent);
    -webkit-mask-image: radial-gradient(70% 60% at 50% 25%, #000, transparent);
    pointer-events: none;
  }
  .hud > * {
    position: relative;
  }
  .orb {
    --f: var(--akzent);
    --g: var(--akzent-2);
    position: relative;
    width: 168px;
    height: 168px;
    display: grid;
    place-items: center;
    margin-bottom: 4px;
  }
  .orb.hoert {
    --f: var(--ok);
    --g: #6ee7b7;
  }
  .orb.denkt {
    --f: var(--akzent-2);
    --g: var(--akzent);
  }
  .halo {
    position: absolute;
    inset: -18px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--f) 38%, transparent), transparent 66%);
    filter: blur(8px);
    animation: atmen 4s ease-in-out infinite;
  }
  .ring {
    position: absolute;
    border-radius: 50%;
  }
  .r1 {
    inset: 0;
    border: 1px dashed color-mix(in srgb, var(--f) 55%, transparent);
    animation: dreh 40s linear infinite;
  }
  .r2 {
    inset: 12px;
    background: conic-gradient(from 0deg, transparent 0 55%, var(--f) 100%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
    animation: dreh 7s linear infinite;
  }
  .r3 {
    inset: 26px;
    background: conic-gradient(from 180deg, transparent 0 60%, var(--g) 100%);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px));
    animation: dreh 11s linear infinite reverse;
    opacity: 0.8;
  }
  .kugel {
    width: 74px;
    height: 74px;
    border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #fff 0, color-mix(in srgb, var(--f) 70%, #fff) 14%, var(--f) 42%, color-mix(in srgb, var(--g) 70%, #000) 100%);
    box-shadow: 0 0 34px 6px color-mix(in srgb, var(--f) 55%, transparent), inset 0 -8px 16px #0005;
    animation: atmen 4s ease-in-out infinite;
  }
  .orb.denkt .r2 {
    animation-duration: 1.6s;
  }
  .orb.denkt .r3 {
    animation-duration: 2.4s;
  }
  .orb.hoert .kugel,
  .orb.hoert .halo {
    animation-duration: 1.2s;
  }
  .orb.spricht .kugel,
  .orb.spricht .halo {
    animation-duration: 0.7s;
  }
  @keyframes dreh {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes atmen {
    50% {
      transform: scale(1.1);
      opacity: 0.85;
    }
  }
  @keyframes puls {
    50% {
      transform: scale(1.3);
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring,
    .kugel,
    .halo,
    .wellen i,
    .avatar,
    .tippt i {
      animation: none !important;
    }
  }
  .titel {
    font-family: var(--schrift-zahl);
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    padding-left: 0.34em;
    background: linear-gradient(90deg, var(--akzent), var(--akzent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .zustand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    font-size: 0.88rem;
  }
  .led {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--akzent);
    box-shadow: 0 0 8px var(--akzent);
  }
  .led.hoert {
    background: var(--ok);
    box-shadow: 0 0 8px var(--ok);
  }
  .led.denkt,
  .led.spricht {
    background: var(--akzent-2);
    box-shadow: 0 0 8px var(--akzent-2);
    animation: puls 0.9s ease-in-out infinite;
  }
  .wellen {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    opacity: 0.25;
    transition: opacity 0.3s;
  }
  .wellen.aktiv {
    opacity: 1;
  }
  .wellen i {
    width: 3px;
    height: 5px;
    border-radius: 2px;
    background: var(--akzent);
  }
  .wellen.aktiv i {
    animation: welle 0.9s ease-in-out infinite;
  }
  .wellen i:nth-child(2) {
    animation-delay: 0.1s;
  }
  .wellen i:nth-child(3) {
    animation-delay: 0.2s;
  }
  .wellen i:nth-child(4) {
    animation-delay: 0.3s;
  }
  .wellen i:nth-child(5) {
    animation-delay: 0.2s;
  }
  .wellen i:nth-child(6) {
    animation-delay: 0.1s;
  }
  @keyframes welle {
    50% {
      height: 22px;
    }
  }
  .zwischen {
    color: var(--akzent);
    font-size: 0.85rem;
  }
  .zahlen {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    width: 100%;
    margin-top: 6px;
  }
  .zahl {
    display: grid;
    gap: 3px;
    text-align: left;
    padding: 10px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--flaeche-2) 70%, transparent);
    border: 1px solid var(--rand);
  }
  .zahl.breit {
    grid-column: 1 / -1;
  }
  .bez {
    font-size: 0.68rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .wert {
    font-family: var(--schrift-zahl);
    font-size: 1.35rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .wert.klein {
    font-size: 1rem;
    line-height: 1.5;
  }
  .balken {
    display: block;
    height: 4px;
    background: var(--flaeche-3);
    border-radius: 3px;
    overflow: hidden;
  }
  .balken b {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--akzent), var(--akzent-2));
    border-radius: 3px;
    transition: width 0.6s;
  }
  .modell {
    font-family: var(--mono);
    font-size: 0.74rem;
    color: var(--text-3);
    word-break: break-all;
  }
  .trenner {
    margin: 0 4px;
    color: var(--rand-hell);
  }
  .demo {
    color: var(--warnung);
  }
  .kacheln {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    font-size: 0.78rem;
    color: var(--text-2);
  }
  .kachel {
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .kachel b {
    color: var(--text);
    font-weight: 600;
    margin-left: 4px;
  }

  /* Gespräch */
  .chat {
    display: grid;
    gap: 12px;
    min-height: 68vh;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    padding: 14px;
    border: 1px solid var(--rand);
    border-radius: 22px;
    background: linear-gradient(180deg, var(--flaeche), color-mix(in srgb, var(--bg) 40%, var(--flaeche)));
    box-shadow: var(--schatten);
  }
  .kopf {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .kopf select {
    flex: 1;
    min-width: 0;
    border-radius: 999px;
    background: var(--flaeche-2);
  }
  .leise {
    background: transparent;
    border: 1px solid var(--rand);
    border-radius: 999px;
    padding: 5px 13px;
    font-size: 0.82rem;
    color: var(--text-2);
  }
  .leise:hover {
    border-color: var(--rand-hell);
    color: var(--text);
  }
  .verlauf {
    overflow-y: auto;
    max-height: 64vh;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 2px;
    scroll-behavior: smooth;
  }
  .leer {
    margin: auto;
    width: 100%;
    max-width: 560px;
    text-align: center;
    display: grid;
    gap: 10px;
    padding: 18px 0;
  }
  .leer h2 {
    margin: 0;
    font-family: var(--schrift-zahl);
    font-size: clamp(1.5rem, 4vw, 2rem);
    font-weight: 600;
    background: linear-gradient(90deg, var(--text), var(--akzent));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .leer p {
    margin: 0 0 8px;
    color: var(--text-2);
  }
  .vorschlaege {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
  }
  .karte {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
    font-size: 0.9rem;
    transition: transform 0.15s, border-color 0.15s, background 0.15s;
  }
  .karte:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--akzent) 55%, var(--rand));
    background: color-mix(in srgb, var(--akzent) 8%, var(--flaeche-2));
  }
  .pfeil {
    order: 2;
    color: var(--akzent);
  }
  .zeile {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .zeile.user {
    justify-content: flex-end;
  }
  .avatar {
    flex: none;
    width: 28px;
    height: 28px;
    margin-top: 2px;
    border-radius: 50%;
    background: radial-gradient(circle at 34% 30%, #fff 0, var(--akzent) 30%, var(--akzent-2) 100%);
    box-shadow: 0 0 14px color-mix(in srgb, var(--akzent) 55%, transparent);
  }
  .avatar.denkt {
    animation: atmen 0.9s ease-in-out infinite;
  }
  .blase {
    max-width: min(86%, 640px);
    padding: 10px 15px;
    display: grid;
    gap: 8px;
    line-height: 1.5;
  }
  .blase p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .blase.user {
    border-radius: 18px 18px 4px 18px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--akzent) 30%, var(--flaeche-2)), color-mix(in srgb, var(--akzent-2) 26%, var(--flaeche-2)));
    border: 1px solid color-mix(in srgb, var(--akzent) 35%, var(--rand));
  }
  .blase.assistant {
    padding-left: 2px;
    padding-top: 4px;
    max-width: min(92%, 680px);
  }
  .schritte {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .schritt {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 0.78rem;
    color: var(--text-2);
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand);
  }
  .schritt.fehler {
    color: var(--ausfall);
    border-color: color-mix(in srgb, var(--ausfall) 40%, var(--rand));
  }
  .punkt {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }
  .schritt.fehler .punkt {
    background: var(--ausfall);
  }
  .schritt.wartet .punkt {
    background: var(--warnung);
    animation: puls 1s ease-in-out infinite;
  }
  .aktionen {
    display: flex;
    gap: 6px;
  }
  .aktionen button {
    padding: 2px 10px;
    font-size: 0.78rem;
    border-radius: 999px;
  }
  .ende {
    color: var(--akzent);
  }
  .tippt {
    display: flex;
    gap: 5px;
    padding: 8px 0;
  }
  .tippt i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--akzent);
    animation: puls 1s ease-in-out infinite;
  }
  .tippt i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .tippt i:nth-child(3) {
    animation-delay: 0.3s;
  }

  /* Eingabe */
  .eingabe {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    border-radius: 999px;
    background: var(--flaeche-2);
    border: 1px solid var(--rand-hell);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .eingabe:focus-within {
    border-color: var(--akzent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--akzent) 18%, transparent), 0 0 30px -10px var(--akzent);
  }
  .eingabe .wachsen {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: 0;
    box-shadow: none;
    padding: 8px 6px;
    font-size: 1rem;
  }
  .mikro,
  .los {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
    border: 0;
  }
  .mikro {
    background: transparent;
    color: var(--text-2);
  }
  .mikro:hover {
    color: var(--text);
    background: var(--flaeche-3);
  }
  .mikro.an {
    background: var(--ok);
    color: #000;
    animation: puls 1.2s ease-in-out infinite;
  }
  .los {
    background: linear-gradient(135deg, var(--akzent), var(--akzent-2));
    color: #04121a;
  }
  .los:disabled {
    background: var(--flaeche-3);
    color: var(--text-3);
    opacity: 1;
  }
  .los.stopp {
    background: var(--ausfall);
    color: #1a0505;
  }
  .leiste {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    font-size: 0.82rem;
    color: var(--text-2);
    padding: 0 6px;
  }
  .tog {
    position: relative;
    display: inline-flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
    margin: 0;
    font-size: 0.82rem;
  }
  .tog input {
    width: 1px;
    height: 1px;
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .knauf {
    position: relative;
    width: 30px;
    height: 17px;
    border-radius: 999px;
    background: var(--flaeche-3);
    border: 1px solid var(--rand-hell);
    transition: background 0.2s;
  }
  .knauf::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--text-2);
    transition: transform 0.2s, background 0.2s;
  }
  .tog.an .knauf {
    background: color-mix(in srgb, var(--akzent) 35%, var(--flaeche-3));
    border-color: var(--akzent);
  }
  .tog.an .knauf::after {
    transform: translateX(13px);
    background: var(--akzent);
  }
  .tog:focus-within .knauf {
    outline: 2px solid var(--akzent);
    outline-offset: 2px;
  }
  .tog:has(input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .schalter {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .hinweis {
    color: var(--text-2);
    font-size: 0.85rem;
    margin: 0;
  }
  .stapel {
    display: grid;
    gap: 14px;
  }
  .form {
    display: grid;
    gap: 12px;
  }
  .form h3 {
    margin: 0;
  }
  .form label {
    display: grid;
    gap: 4px;
  }
  .form label.schalter {
    display: inline-flex;
  }
  .optionen {
    display: grid;
    gap: 8px;
  }
  .option {
    border: 1px solid var(--rand);
    border-radius: var(--radius);
    padding: 10px 12px;
    cursor: pointer;
    gap: 2px;
  }
  .option span {
    color: var(--text-2);
    font-size: 0.85rem;
  }
  .option input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .option.gewaehlt {
    border-color: var(--akzent);
    background: color-mix(in srgb, var(--akzent) 10%, var(--flaeche));
  }
  .option:focus-within {
    outline: 2px solid var(--akzent);
  }
  .warnung {
    border-color: var(--warnung);
  }
  .laedt {
    color: var(--text-2);
    padding: 20px;
  }
</style>
