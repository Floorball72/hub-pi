// Service Worker: hält die App Hülle offline verfügbar. API Daten kommen immer frisch vom Pi.
const CACHE = 'pihub-v1';
const HUELLE = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/status')) return;
  // Assets mit Hash: Cache zuerst. Seiten: Netz zuerst, Cache als Rückfall.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (r) =>
          r ||
          fetch(e.request).then((antwort) => {
            const kopie = antwort.clone();
            caches.open(CACHE).then((c) => c.put(e.request, kopie));
            return antwort;
          }),
      ),
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match('/')));
});
