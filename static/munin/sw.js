/* Offline support.
 *
 * The shell and the card data are precached so the app opens with no network at
 * all. The 24 diagrams are 2 MB, so they are cached as they are first seen
 * rather than forced down on install — with a button in Progress → Offline to
 * pull the lot deliberately before you lose signal.
 */
const V = 'munin-ef70698eae';
const SCOPE = new URL('./', self.registration.scope).pathname;

/** What we expect back for a given path. A 200 is not enough: a captive portal
 *  answers every request with its own sign-in page. */
function typeFor(pathname) {
  if (pathname.endsWith('.js')) return 'application/javascript';
  if (pathname.endsWith('.css')) return 'text/css';
  if (pathname.endsWith('.json') || pathname.endsWith('.webmanifest')) return 'application/json';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  return 'text/html';
}

function ok(r, expected) {
  if (!r || !r.ok || r.type === 'opaque') return false;
  const got = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!got) return true;                       // some static servers say nothing
  if (expected === 'application/javascript') {
    return /javascript|ecmascript/.test(got);
  }
  if (expected === 'application/json') {
    return /json|manifest/.test(got);
  }
  return got === expected;
}

// The install screenshots in shots/ are deliberately not in here: the browser
// reads them once, at install time, when it is by definition online. Precaching
// half a megabyte of shop window into the offline shell is the wrong trade.
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'munin.js',
  'doodles-munin.js',
  'manifest.webmanifest',
  'fonts/dm-mono-400.woff2',
  'fonts/architects-daughter.woff2',
  'fonts/dm-mono-500.woff2',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'courses/day-skipper/course.json',
  'courses/day-skipper/doodles.js',
  'courses/day-skipper/cards.json',
  'courses/day-skipper/figures.json',
  'courses/day-skipper/videos.json',
  'courses/competent-crew/course.json',
  'courses/competent-crew/doodles.js',
  'courses/competent-crew/cards.json',
  'courses/competent-crew/figures.json',
];
// './' is deliberately excluded: it reduces to the empty string, and
// `endsWith('')` is true of every path, which turned the runtime cache into
// "keep a permanent copy of every same-origin GET this page ever makes".
const SHELL_FILES = SHELL.filter((s) => s !== './');

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'prefetch' && Array.isArray(e.data.urls)) {
    e.waitUntil((async () => {
      const cache = await caches.open(V);
      const total = e.data.urls.length;
      let done = 0, failed = 0;
      const say = async (type) => {
        const cs = await self.clients.matchAll();
        cs.forEach((c) => c.postMessage({ type, done, total, failed }));
      };
      for (const u of e.data.urls) {
        try {
          if (!(await cache.match(u))) await cache.add(u);
        } catch (err) {
          failed++;   // one missing diagram must not abort the rest
        }
        done++;
        await say('prefetching');   // 2 MB on a weak signal needs to show movement
      }
      await say('prefetched');
    })());
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Card data and the clip map: network first so a rebuilt deck or a newly
  // attached clip arrives, cache as the fallback.
  if (url.pathname.endsWith('cards.json') || url.pathname.endsWith('videos.json')
      || url.pathname.endsWith('figures.json')) {
    e.respondWith(
      fetch(req).then((r) => {
        // Only a real deck gets cached. One 404 during a deploy used to become
        // the permanent offline copy, and the app then failed exactly when
        // being offline was the point.
        if (ok(r, 'application/json')) {
          const copy = r.clone();
          caches.open(V).then((c) => c.put(req, copy));
        }
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // A navigation is the whole app: serve the shell whatever query string is on
  // the URL, so a shared or tagged link is not a blank page offline.
  if (req.mode === 'navigate') {
    const isRoot = url.pathname === SCOPE || url.pathname === SCOPE + 'index.html';
    e.respondWith(
      fetch(req)
        .then((r) => {
          // Only the app's own page may be stored as the shell. This used to
          // cache *any* navigation in scope, so opening a sibling file once
          // meant the app booted into that file for ever after, offline.
          if (isRoot && ok(r, 'text/html')) {
            const copy = r.clone();
            caches.open(V).then((c) => c.put('./', copy));
          }
          return r;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })
          .then((hit) => hit || caches.match('index.html', { ignoreSearch: true })))
    );
    return;
  }

  // Video is never cached. 53 MB of clips would evict the shell that makes the
  // app work offline in the first place, to store something you watch once.
  if (url.pathname.includes('/video/')) return;

  const isShell = SHELL_FILES.some((s) => url.pathname.endsWith('/' + s));
  const isImage = url.pathname.includes('/img/') || /\/icon-[\w-]+\.png$/.test(url.pathname);

  // Only our own files are cached. Anything else on the origin — the rest of
  // the site this app is a subdirectory of — is left alone.
  if (!isShell && !isImage) return;

  if (isShell) {
    // Stale while revalidate: instant from cache, but a shipped fix to app.js
    // lands on the next load instead of never.
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((r) => {
          // A hotel-WiFi sign-in page is a 200. Without the type check it
          // becomes the cached app.js and the app never boots again.
          if (ok(r, typeFor(url.pathname))) caches.open(V).then((c) => c.put(req, r.clone()));
          return r;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Diagrams: cache first, they never change without a new cache version.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (ok(r, 'image/png')) caches.open(V).then((c) => c.put(req, r.clone()));
      return r;
    }))
  );
});
