// Offline support for DPWCS LOCO: the network when there is one (so updates
// arrive straight away), the last saved copy when there is not.
const CACHE = 'dpwcs-loco-v14';
const FILES = [
  './', 'index.html', 'app.js', 'manifest.webmanifest', '../styles.css',
  '../js/logic.js', '../js/seed.js', '../js/sheet.js', '../js/xlsx.js', '../js/canvas.js', '../js/db.js', '../js/sync.js',
  '../js/syncdata.js', '../js/config.js', '../js/historyimport.js', '../js/reports.js', '../js/summary.js', '../js/paste.js', '../js/official.js', '../js/filetext.js', '../js/unusualimport.js', '../js/unusual-data.js', '../js/unusual-official.js',
  '../icons/icon-192.png', '../icons/logo.png', '../icons/tigoods.png', '../icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
