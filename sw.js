// Riverbreaker service worker: precache the whole app, then serve from cache first.
// Bump VERSION on every release so that old caches are removed.
const VERSION = 'riverbreaker-v4';

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.ico',
  'fonts/fonts.css',
  'fonts/saira-400.woff',
  'fonts/saira-condensed-600.woff',
  'fonts/saira-condensed-700.woff',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-16.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('riverbreaker-') && k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GET requests:
// answer from the cache at once, refresh the cache in the background when online.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const isNav = req.mode === 'navigate';
    const cached = await cache.match(isNav ? 'index.html' : req, { ignoreSearch: true });

    const refresh = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(isNav ? 'index.html' : req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    const res = await refresh;
    if (res) return res;
    return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
  })());
});
