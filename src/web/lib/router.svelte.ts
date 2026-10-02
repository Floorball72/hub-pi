// Kleiner Router auf Basis der History API.
export const ort = $state({ pfad: location.pathname, suche: location.search });

export function navigieren(ziel: string, ersetzen = false) {
  if (ziel === location.pathname + location.search) return;
  if (ersetzen) history.replaceState(null, '', ziel);
  else history.pushState(null, '', ziel);
  ort.pfad = location.pathname;
  ort.suche = location.search;
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  ort.pfad = location.pathname;
  ort.suche = location.search;
});

/** Klicks auf interne Links abfangen */
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const href = a.getAttribute('href');
  if (!href?.startsWith('/') || href.startsWith('//') || a.target === '_blank' || a.hasAttribute('download'))
    return;
  if (href.startsWith('/api/') || href === '/status' || href.startsWith('/status?')) return;
  e.preventDefault();
  navigieren(href);
});

export function parameter(name: string): string | null {
  return new URLSearchParams(ort.suche).get(name);
}
