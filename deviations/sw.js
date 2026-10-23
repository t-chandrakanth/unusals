// Offline support for Interchange Deviations: the network when there is one, the last saved copy when there is not.
const CACHE = 'deviations-v1';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', '../js/deviations.js', '../js/paste.js', '../js/historyimport.js', '../js/canvas.js', '../js/sheet.js', '../js/pdf.js', '../js/logic.js', '../js/block.js', '../js/events.js', '../js/repercussions.js', '../icons/icon-192.png', '../icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
