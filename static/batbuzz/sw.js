const SHELL_CACHE = 'batbuzz-shell-v2';
const DATA_CACHE = 'batbuzz-data-v2';
const PREFIX = 'batbuzz-';
const SCOPE_PATH = '/batbuzz/';
const SHELL_ASSETS = [
  SCOPE_PATH,
  `${SCOPE_PATH}manifest.webmanifest`,
  `${SCOPE_PATH}icons/bat.svg`,
  `${SCOPE_PATH}icons/bat-192.png`,
  `${SCOPE_PATH}icons/bat-512.png`,
  `${SCOPE_PATH}icons/bat-maskable-512.png`,
    "/batbuzz/assets/index-BYwjvlfZ.js",
  "/batbuzz/assets/index-BwZdqqv1.css",
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && ![SHELL_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  // Capability-bearing state reads and explicit no-store probes always bypass
  // CacheStorage. Mutating requests are already excluded by the GET guard.
  if (event.request.headers.has('authorization') || event.request.cache === 'no-store') return;
  if (url.pathname.includes('/api/')) return;
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/manifest.json')) {
    event.respondWith(networkFirst(event.request, url.pathname.endsWith('/manifest.json') ? DATA_CACHE : SHELL_CACHE));
    return;
  }
  event.respondWith(cacheFirst(
    event.request,
    url.pathname.includes('/data/') ? DATA_CACHE : SHELL_CACHE,
  ));
});
