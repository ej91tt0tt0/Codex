/* ASTER mobile web app lifecycle. Deliberately never caches private data. */
const VERSION = 'aster-1.6';
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('aster-'))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
// Network-only: microphone sessions, messages, transcripts, and API data
// must never be accessible as offline cached copies on a shared phone.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
