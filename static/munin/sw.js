/* Offline support.
 *
 * The shell and the card data are precached so the app opens with no network at
 * all. Diagrams are a few megabytes, so they are cached as they are first seen
 * rather than forced down on install — with a button in Progress → Offline to
 * pull the lot deliberately before you lose signal.
 *
 * One cache for the shell, one per course. They used to share a single cache
 * named after a hash of everything shipped, so editing one card in one course
 * evicted the app and every other course for everyone. They also used to share
 * a hand-written list of every course's files, which is the third place a new
 * course had to be registered — and the one you find last, because forgetting
 * it ships a course that works online and 404s offline.
 *
 * BUILD is stamped by scripts/deploy-to-kkonrad.sh from the content actually
 * shipped: without that, a cache-first shell never updates.
 */
const BUILD = { shell: '26ff1da43d', courses: { 'day-skipper': '73314ca1f6', 'competent-crew': '657f7ca84f' } };
const SHELL_V = 'munin-shell-' + BUILD.shell;
const courseV = (id) => 'munin-course-' + id + '-' + (BUILD.courses[id] || 'dev');
const SCOPE = new URL('./', self.registration.scope).pathname;

/* Everything a course may ship. Optional members are normal: Competent Crew
 * has no clips, an unillustrated course has no figures. */
const COURSE_FILES = ['course.json', 'doodles.js', 'cards.json', 'figures.json',
  'figures.css', 'videos.json', 'boot.html', 'boot.css'];

/** Which course a same-origin path belongs to, if any. */
function courseOf(pathname) {
  const m = /\/courses\/([a-z0-9][a-z0-9-]*)\//.exec(pathname);
  return m ? m[1] : null;
}

/* The course list, or NULL if it could not be read.
 *
 * The difference matters more here than anywhere else in the app: this list
 * decides which caches are still wanted, and `[]` from a failed read used to
 * mean "no course exists", so one unparseable response — a half-written
 * deploy, a proxy error page served as JSON — deleted every course's cache,
 * including the megabytes of diagrams somebody deliberately saved for a
 * flight. The cached copy is tried when the network will not answer. */
async function readCourses() {
  const parse = async (r) => {
    const idx = await r.json();
    if (!idx || !Array.isArray(idx.courses)) throw new Error('no course list');
    return idx.courses.filter((s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s));
  };
  try {
    const r = await fetch('courses/index.json', { cache: 'no-cache' });
    if (r.ok) return await parse(r);
  } catch (e) { /* offline, or the fetch itself failed */ }
  try {
    const hit = await caches.match('courses/index.json');
    if (hit) return await parse(hit);
  } catch (e) { /* a cached copy that is not the registry either */ }
  return null;
}

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
  // The importer and its parsers. Loaded only when someone brings a deck, and
  // precached anyway: importing a file off your own disk is exactly the thing
  // that should not need a network.
  'import.js',
  'lib/anki.js',
  'lib/deck.js',
  'lib/html.js',
  'lib/receipt.js',
  'lib/sqlite.js',
  'lib/store.js',
  'lib/template.js',
  'lib/unzip.js',
  // Imported by import.js AND by lib/deck.js. Missing here, the whole
  // importer module graph failed to resolve offline — which is the one place
  // it is most obviously supposed to work — and app.js's boot-time deck check
  // silently stopped running, because its import is a caught dynamic one.
  'lib/validate.js',
  'lib/vendor/fzstd.js',
  'manifest.webmanifest',
  'fonts/dm-mono-400.woff2',
  'fonts/architects-daughter.woff2',
  'fonts/dm-mono-500.woff2',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  // The one list of courses. Every other place that needed it now reads it.
  'courses/index.json',
];
// './' is deliberately excluded: it reduces to the empty string, and
// `endsWith('')` is true of every path, which turned the runtime cache into
// "keep a permanent copy of every same-origin GET this page ever makes".
const SHELL_FILES = SHELL.filter((s) => s !== './');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_V);
    await shell.addAll(SHELL);
    // Each course into its own cache, and one course that will not install is
    // not a reason for the app to have no offline shell at all.
    for (const id of (await readCourses()) || []) {
      const cache = await caches.open(courseV(id));
      for (const f of COURSE_FILES) {
        // add() rejects on a 404, and most courses ship only some of these.
        // Optional files are meant to be missing; anything else is worth
        // saying, because a course cached without its cards is a course that
        // opens offline to nothing and gives no clue why.
        await cache.add('courses/' + id + '/' + f)
          .catch((e) => console.warn('munin: ' + id + '/' + f + ' not cached', e));
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ids = await readCourses();
    const live = new Set([SHELL_V].concat((ids || []).map(courseV)));
    for (const k of await caches.keys()) {
      if (!/^munin-/.test(k) || live.has(k)) continue;
      // Only Munin's own caches, and only the ones no longer current: a course
      // whose cards changed loses its own cache and keeps everyone else's.
      // WITHOUT A LIST, NOTHING BELONGING TO A COURSE IS TOUCHED — an
      // unreadable registry is not evidence that every course was removed,
      // and treating it as such threw away saved diagrams by the megabyte.
      if (ids === null && /^munin-course-/.test(k)) continue;
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

/** Where a request belongs: its course's cache, or the shell's. */
function cacheFor(pathname) {
  const id = courseOf(pathname);
  return id ? courseV(id) : SHELL_V;
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'prefetch' && Array.isArray(e.data.urls)) {
    e.waitUntil((async () => {
      const total = e.data.urls.length;
      let done = 0, failed = 0;
      const say = async (type) => {
        const cs = await self.clients.matchAll();
        cs.forEach((c) => c.postMessage({ type, done, total, failed }));
      };
      for (const u of e.data.urls) {
        try {
          // A course's diagrams belong in that course's cache, so pulling one
          // course down for a flight does not push another one out.
          const cache = await caches.open(cacheFor(new URL(u, location.href).pathname));
          if (!(await cache.match(u))) await cache.add(u);
        } catch (err) {
          failed++;   // one missing diagram must not abort the rest
        }
        done++;
        await say('prefetching');   // megabytes on a weak signal need to show movement
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
          caches.open(cacheFor(url.pathname)).then((c) => c.put(req, copy));
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
            caches.open(SHELL_V).then((c) => c.put('./', copy));
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
  // A course's own files are matched by where they live rather than by a list
  // naming each course, which is what made adding a course a service-worker
  // edit — and, when it was forgotten, a course that worked online only.
  const isCourseFile = !!courseOf(url.pathname)
    && COURSE_FILES.some((s) => url.pathname.endsWith('/' + s));
  const isImage = url.pathname.includes('/img/') || /\/icon-[\w-]+\.png$/.test(url.pathname);

  // Only our own files are cached. Anything else on the origin — the rest of
  // the site this app is a subdirectory of — is left alone.
  if (!isShell && !isCourseFile && !isImage) return;

  if (isShell || isCourseFile) {
    // Stale while revalidate: instant from cache, but a shipped fix to app.js
    // — or a course's redrawn loading screen — lands on the next load instead
    // of never.
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((r) => {
          // A hotel-WiFi sign-in page is a 200. Without the type check it
          // becomes the cached app.js and the app never boots again.
          if (ok(r, typeFor(url.pathname))) {
            caches.open(cacheFor(url.pathname)).then((c) => c.put(req, r.clone()));
          }
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
      if (ok(r, 'image/png')) caches.open(cacheFor(url.pathname)).then((c) => c.put(req, r.clone()));
      return r;
    }))
  );
});
