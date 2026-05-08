// Service worker — passes through online, never blocks the UI on offline scoring.
// The app already queues offline writes via IndexedDB; this SW exists to keep
// the shell cached and to swallow score POSTs while offline.
const VERSION = 'jp-v1';
const SHELL = ['/'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

async function passthroughOrFakeOk(req) {
  try {
    const res = await fetch(req);
    return res;
  } catch {
    return new Response(JSON.stringify({ queued: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/api/judge/scores') {
    event.respondWith(passthroughOrFakeOk(event.request.clone()));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/') {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request).then((res) => {
          if (res && res.status === 200) cache.put(event.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      }),
    );
  }
});
