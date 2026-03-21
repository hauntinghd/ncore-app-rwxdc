const APP_VERSION = '__APP_VERSION__';
const BUILD_TIME = '__BUILD_TIME__';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const client of clients) {
        client.postMessage({
          type: 'NCORE_SW_ACTIVATED',
          version: APP_VERSION,
          buildTime: BUILD_TIME,
        });
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event?.data?.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
