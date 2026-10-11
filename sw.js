// The first version of this site registered a service worker here that covered
// everything under /unusals/. The two apps (dpwcs/ and unusual/) now each have
// their own, so this one clears its caches and removes itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('loco-tracker')) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
