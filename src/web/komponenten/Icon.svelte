<script lang="ts">
  // Eigene Liniensymbole, damit keine Icon Bibliothek nötig ist.
  let { name, groesse = 20 }: { name: string; groesse?: number } = $props();

  const pfade: Record<string, string> = {
    zentrale: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    scont: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
    rettung: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z',
    drohne: 'M5 5h4M15 5h4M7 5v3M17 5v3M9 10h6v4H9zM7 8l2 2M17 8l-2 2M9 14l-2 3M15 14l2 3',
    unihockey: 'M5 3l9 13a3 3 0 0 0 4 1l2-1M17 7a2 2 0 1 0 0 .01',
    aufgaben: 'M9 5h11M9 12h11M9 19h11M3.5 5l1.5 1.5L7.5 4M3.5 12l1.5 1.5 2.5-2.5M4 19h2',
    finanzen: 'M3 7h18v12H3zM3 11h18M7 15h3M16 4H6',
    smarthome: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5',
    analyse: 'M4 4h16v16H4zM12 4v16M8 12a1 1 0 1 0 0 .01M15 8l2 2M17 8l-2 2M15 15l2 2M17 15l-2 2',
    swissunihockey: 'M4 5h16v14H4zM8 3v4M16 3v4M4 10h16M8 14l2 2 4-4',
    wetter: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z',
    karte: 'M9 4l6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14',
    alarm: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
    status: 'M3 12h4l3-8 4 16 3-8h4',
    system: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    suche: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    timeline: 'M4 6h16M4 12h10M4 18h13M20 12h.01',
    notiz: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h6',
    menu: 'M4 7h16M4 12h16M4 17h16',
    kiosk: 'M3 5h18v12H3zM8 21h8M12 17v4',
    fokus: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 9V5h4M17 5h4v4M21 15v4h-4M7 19H3v-4',
    abmelden: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    einstellungen: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-1.9 1.9-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V20h-2.6v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1-1.9-1.9.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H4v-2.6h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 1.9-1.9.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V4h2.6v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 1.9 1.9-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H20v2.6h-.1a1.7 1.7 0 0 0-1.5 1z',
    heli: 'M3 6h18M12 6v3M6 12a6 3 0 0 1 12 0v1a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3zM18 12h3M9 16l-1 3M15 16l1 3M6 19h12',
    blitz: 'M13 2L4 14h7l-1 8 9-12h-7z',
    webcam: 'M12 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 20h8M12 16v4',
    ort: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    aktivitaet: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
    backup: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    neustart: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
    plus: 'M12 5v14M5 12h14',
    loeschen: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    bearbeiten: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    pfeil: 'M9 6l6 6-6 6',
    zurueck: 'M15 6l-6 6 6 6',
    schliessen: 'M6 6l12 12M18 6L6 18',
    uhr: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    zug: 'M7 3h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 10h14M8 21l2-3M16 21l-2-3M9 14h.01M15 14h.01',
    pdf: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4',
    start: 'M8 5v14l11-7z',
    stopp: 'M7 7h10v10H7z',
    haken: 'M5 12l5 5 9-10',
    werkzeug: 'M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2zM14 6l3-3',
    akku: 'M4 8h14v8H4zM18 11h2v2h-2M7 10v4M10 10v4',
    dokument: 'M6 3h9l4 4v14H6zM14 3v5h5',
    sonne: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    events: 'M4 6h16v14H4zM8 3v5M16 3v5M4 11h16M12 14l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 16.3l2-.3z',
    content: 'M4 4h16v16H4zM4 9h16M9 4v16M12 13h5M12 16h3',
    veranstaltungen: 'M4 8l8-4 8 4v2H4zM6 10v8M10 10v8M14 10v8M18 10v8M3 20h18',
    parken: 'M5 3h14v18H5zM10 17V7h3a3 3 0 0 1 0 6h-3',
    dienste: 'M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6',
    sicherheit: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
    abhaengigkeiten: 'M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 8v2a4 4 0 0 0 4 4h1M18 8v2a4 4 0 0 1-4 4h-1M12 14v2',
    aenderungen: 'M4 4h7v16H4zM13 4h7v16h-7M6 8h3M6 12h3M15 8h3M15 12h2M15 16h3',
    teams: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v4M20.5 9.5l-5 0M3.5 9.5h5M14.2 13.5l3 4.5M9.8 13.5l-3 4.5',
    auffaelligkeiten: 'M3 17l5-5 4 3 4-7 5 4M17 3l1 2M21 7l-2 1',
    heilung: 'M12 20s-8-4.6-8-10.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8C20 15.4 12 20 12 20zM9 12h6M12 9v6',
    update: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    abrufe: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
    drehwetter: 'M4 7h11l3-2v10l-3-2H4zM6 18h10a3 3 0 0 0 .3-6',
    mond: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    ebenen: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  };
</script>

<svg
  width={groesse}
  height={groesse}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={pfade[name] ?? pfade.status} />
</svg>
