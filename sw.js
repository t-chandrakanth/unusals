// Offline support for the combined app (SCR TI GOODS): its two tabs are the apps in
// dpwcs/ and unusual/, which keep their own copies for offline use. This one keeps
// the page around them. Network first, the last saved copy when there is no network.
const CACHE = 'scr-ti-goods-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // the first version of this site left caches named loco-tracker...; they are not needed any more
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('loco-tracker')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // only the page around the apps; the apps' own addresses are handled by their own workers
  const scope = new URL(self.registration.scope).pathname;
  const path = url.pathname.slice(scope.length);
  if (path.startsWith('dpwcs/') || path.startsWith('unusual/') || path.startsWith('js/') || path === 'styles.css') return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
