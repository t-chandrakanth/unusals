// Offline support for SCR UNUSALS: the network when there is one, the last saved copy when there is not.
const CACHE = 'scr-unusals-v42';
const FILES = [
  './', 'index.html', 'app.css', 'app.js', 'records.js', 'stats.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/tigoods.png', '../icons/logo.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  '../styles.css', '../js/logic.js', '../js/sync.js', '../js/syncdata.js', '../js/config.js', '../js/sheet.js', '../js/canvas.js',
  '../js/xlsx.js', '../js/official.js', '../js/reports.js', '../js/summary.js', '../js/block.js', '../js/pdf.js', '../js/events.js', '../js/stalling.js', '../js/stallingcanvas.js', '../js/unusalreport.js', '../js/repercussions.js', '../js/unusalcanvas.js', '../js/filetext.js', '../js/unusual-data.js', '../js/unusual-official.js', '../js/unusualimport.js',
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
