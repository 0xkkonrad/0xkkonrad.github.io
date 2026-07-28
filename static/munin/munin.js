/* Munin — the shell in front of the courses.
 *
 * Boot order: this file decides which course is active (localStorage), replays
 * that course's cached loading screen before the first paint, fetches its
 * course.json, injects the theme (accent vars + boot scene), then loads the
 * course's own doodles.js and finally app.js — which reads the COURSE global
 * for its deck, art maps and storage key. With no course picked it renders the
 * shelf instead and app.js never loads.
 *
 * Courses never share theme files: each folder under courses/ is complete in
 * itself. Two files being identical is a coincidence, not a link.
 *
 * Munin's own theme is not a special case — it is the DEFAULT every course
 * falls back into, slot by slot (MUNIN.theme below). A course that brings an
 * accent and no frieze gets its accent and Munin's frieze; a deck someone
 * imported brings none of it and is dressed entirely by Munin.
 *
 * Sync is deliberately OFF in this build. The live Day Skipper app at
 * /day-skipper shares this origin and its Supabase rows; Munin joining that
 * sync before the parity gate would corrupt real study state. DSSync below is
 * a stub with the full surface app.js touches.
 */
'use strict';

const MUNIN = {
  lastKey: 'munin/last-course',
  /* Every place that names a storage slot names it here. These templates used
   * to be written out by hand in app.js, store.js and the orphan sweep, which
   * is three chances to change one of them and not the others. */
  stateKey: (id) => 'munin/' + id + '/state/v1',
  bootKey: (id) => 'munin/boot/' + id,
  registry: 'courses/index.json',

  /* A course id is a folder name and goes straight into a URL, so it is
   * checked as a shape rather than against a list: the resume path must not
   * have to wait for the registry to load before it can boot a course.
   * A string, and not something that merely stringifies into one — `["x"]`
   * used to pass and fetch a course called x. */
  idOk: (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id),

  /* Munin's own theme: the default for every slot a course leaves empty. */
  theme: {
    accent: { light: '#0e3f39', dark: '#35917f', inkLight: '#fffdf7', inkDark: '#141519' },
    boot: { art: 'perch', line: 'Loading…' },
    fallback: 'perch',
    /* Ten of them, named. The frieze is ten drawings and no more — that is
     * what fits a 320px screen without a sideways scrollbar — so it cannot be
     * "whatever MUNIN_DOODLE holds": the set grew to fourteen the day the
     * hoard needed fourteen distinct drawings. The gate keeps this a subset. */
    friezeArt: ['perch', 'peek', 'flap', 'carry', 'roost',
      'hoard', 'puff', 'strut', 'quill', 'bow'],
    notice: 'Revision material. Progress is stored on this device only.',
  },
};
globalThis.MUNIN = MUNIN;

const isLocal = (id) => /^local-[a-z0-9]+$/.test(String(id || ''));

/* app.js calls these; every one is a no-op that reports "sync off". */
globalThis.DSSync = {
  KEY: 'munin/sync-off',
  enabled: () => false,
  status: () => ({}),
  schedule: () => {},
  sync: async () => {},
  stable: (s) => JSON.stringify(s),
  formatKey: () => '—',
  normaliseKey: (k) => k,
  init: () => {},
  turnOn: () => {},
  turnOff: () => {},
};

/* The colour theme belongs to Munin, not to a course: the shelf paints before
 * any course is booted, and a preference stored per course would flip as you
 * switched between them. One key, read before the first paint. Light is the
 * default — the app is paper first, and dark is a choice you make. */
const THEME_ORDER = ['light', 'dark', 'auto'];
const MuninTheme = {
  key: 'munin/theme',
  get() {
    const t = localStorage.getItem(MuninTheme.key);
    return THEME_ORDER.includes(t) ? t : 'light';
  },
  set(t) {
    localStorage.setItem(MuninTheme.key, t);
    MuninTheme.apply();
  },
  cycle() {
    const t = MuninTheme.get();
    MuninTheme.set(THEME_ORDER[(THEME_ORDER.indexOf(t) + 1) % THEME_ORDER.length]);
  },
  apply() {
    const t = MuninTheme.get();
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark'
      || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.getElementById('theme-color');
    if (meta) meta.setAttribute('content', dark ? '#141519' : '#f0eee7');
    // Every glyph on the page — the shelf's and the course header's — says the
    // same thing, because they are the same setting.
    for (const g of document.querySelectorAll('[data-theme-glyph]')) {
      g.textContent = t === 'auto' ? '◐' : t === 'dark' ? '☾' : '☀';
    }
  },
};
globalThis.MuninTheme = MuninTheme;

/* ── installing ───────────────────────────────────────────────────────────
 *
 * Captured here, at parse time, because the shell is the only script that is
 * always running: Chrome decides the app is installable and fires
 * beforeinstallprompt as soon as the manifest and the worker are in hand —
 * which on the shelf is before any course, and so before app.js exists. The
 * event does not queue. With nobody listening it is simply gone for the life of
 * the page, and the offer never appears anywhere. (Day Skipper shipped that bug
 * once, from one screen; Munin's boot order would have re-earned it.)
 *
 * Munin holds the event; the picker and Settings both just draw it. */
const MuninInstall = {
  event: null,

  installed() {
    // navigator.standalone is iOS's own, and the only signal there.
    return matchMedia('(display-mode: standalone)').matches
      || matchMedia('(display-mode: minimal-ui)').matches
      || matchMedia('(display-mode: fullscreen)').matches
      || navigator.standalone === true;
  },

  /* iOS has no install API at all, so the offer there is instructions. */
  ios() {
    const ua = navigator.userAgent;
    // iPadOS 13+ reports itself as a Mac. The touch points are the tell.
    return /iPhone|iPad|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },

  /** Nothing to say to a browser that can neither prompt nor be told how. */
  offerable() {
    return !MuninInstall.installed() && (MuninInstall.event || MuninInstall.ios());
  },

  async prompt() {
    // The event is single-use: Chrome invalidates it once prompt() is called,
    // and fires a fresh one if the offer is declined.
    const e = MuninInstall.event;
    MuninInstall.event = null;
    if (!e) return;
    e.prompt();
    await e.userChoice.catch(() => {});
    MuninInstall.refresh();
  },

  /* Both places that draw the offer, kept honest whenever the answer changes. */
  refresh() {
    renderShelfInstall();
    globalThis.renderInstall?.();
  },
};

addEventListener('beforeinstallprompt', (e) => {
  // Stops Chrome's own mini-infobar, so the offer appears once, in the app's
  // voice, on a screen it belongs on.
  e.preventDefault();
  MuninInstall.event = e;
  MuninInstall.refresh();
});

addEventListener('appinstalled', () => {
  MuninInstall.event = null;
  MuninInstall.refresh();
});

globalThis.MuninInstall = MuninInstall;

/* The picker's copy of the offer. First run is the one moment the app can say
 * "keep me" before anyone has picked anything, so it sits under the tiles —
 * below the thing you came for, never in front of it. It needs no dismissal:
 * installing removes it, and nothing else here is a nudge. */
function renderShelfInstall() {
  const card = document.getElementById('shelf-install');
  if (!card) return;
  if (!MuninInstall.offerable()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const steps = card.querySelector('.shelf-install-steps');
  const btn = card.querySelector('#shelf-install-btn');
  btn.hidden = !MuninInstall.event;
  steps.hidden = !!MuninInstall.event;
  steps.innerHTML = MuninInstall.event ? ''
    : '<li>tap the share button in the browser bar</li><li>choose “Add to Home Screen”</li>';
}

function muninDoodle(name, cls, style) {
  const d = MUNIN_DOODLE[name] || MUNIN_DOODLE.perch;
  return `<svg class="dood ${cls || ''}" viewBox="0 0 32 32" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    ${style ? `style="${style}"` : ''}><path d="${d}"/></svg>`;
}

/* One <style> block per boot: the four scopes app.css declares its accent in,
 * overridden from course.json (or Munin's own ink teal on the shelf). */
function injectAccent(a) {
  const old = document.getElementById('course-theme');
  if (old) old.remove();
  const s = document.createElement('style');
  s.id = 'course-theme';
  s.textContent = `
    :root { --accent: ${a.light}; --accent-ink: ${a.inkLight}; --g4: ${a.light}; }
    @media (prefers-color-scheme: dark) {
      :root { --accent: ${a.dark}; --accent-ink: ${a.inkDark}; --g4: ${a.dark}; }
    }
    :root[data-theme="light"] { --accent: ${a.light}; --accent-ink: ${a.inkLight}; --g4: ${a.light}; }
    :root[data-theme="dark"] { --accent: ${a.dark}; --accent-ink: ${a.inkDark}; --g4: ${a.dark}; }`;
  document.head.appendChild(s);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/* An accent goes into a style attribute and into a stylesheet, where a `;` or
 * a `}` is a way out of the declaration it was supposed to be. A colour that
 * is not a colour is a mistake in a course file, and it gets Munin's. */
const COLOUR = /^#[0-9a-f]{3,8}$/i;
function colours(a) {
  const t = MUNIN.theme.accent;
  const out = Object.assign({}, t);
  for (const k of Object.keys(t)) if (COLOUR.test(a && a[k])) out[k] = a[k];
  return out;
}

/** Every slot a course left empty, filled from Munin's own theme. */
function withDefaults(c) {
  const t = MUNIN.theme;
  return Object.assign({}, c, {
    accent: colours(c.accent),
    boot: Object.assign({}, t.boot, c.boot || {}),
    fallback: c.fallback || t.fallback,
    sectionArt: c.sectionArt || {},
    groupArt: c.groupArt || {},
    friezeArt: (c.friezeArt && c.friezeArt.length) ? c.friezeArt : t.friezeArt,
    notice: c.notice || t.notice,
  });
}

/* ── the loading screen ───────────────────────────────────────────────────
 *
 * A course owns its loading screen: boot.html is the scene, boot.css is how it
 * moves, boot.line is what it says. Munin's raven is in index.html as the
 * default, so there is always a scene at first paint.
 *
 * The catch this solves: the course's scene cannot be known until course.json
 * has been fetched, which is the whole window the screen exists to cover. So
 * the scene the course drew last time is kept in localStorage and replayed
 * synchronously, here, before anything paints. First-ever open of a course
 * gets Munin's raven; every open after that gets the course's own.
 */
/* A cached scene is markup that goes into innerHTML, and localStorage is not
 * a trustworthy place to keep markup. `<script>` never runs through innerHTML,
 * but `onerror` and `onbegin` do, at parse time, before anything else on the
 * page — so a one-shot injection anywhere else on this origin (kkonrad.com
 * carries a whole site besides this app) would become code that runs inside
 * Munin on every visit, for ever, offline included. Parsed, stripped and
 * re-serialised: the same rule the importer applies to a stranger's cards. */
function safeScene(html) {
  const doc = new DOMParser().parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg">' + String(html) + '</svg>', 'image/svg+xml');
  if (doc.querySelector('parsererror')) return '';
  for (const el of doc.querySelectorAll('script, foreignObject, iframe, image, use')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || (/^(href|xlink:href|src)$/.test(n) && !/^#/.test(a.value.trim()))) {
        el.removeAttribute(a.name);
      }
    }
  }
  return doc.documentElement.innerHTML;
}

function applyBoot(b) {
  const boot = document.getElementById('boot');
  if (!boot || !b) return;
  // The colour comes with the scene. Without it the replayed screen paints in
  // whatever the stylesheet's default accent happens to be until course.json
  // arrives — which is the whole window this screen exists to cover.
  if (b.accent) injectAccent(b.accent);
  if (b.css) {
    let style = document.getElementById('boot-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'boot-style';
      document.head.appendChild(style);
    }
    if (style.textContent !== b.css) style.textContent = b.css;
  }
  const scene = boot.querySelector('#boot-scene');
  // The scene is a course's own file, and it replaces markup rather than being
  // added to it — a second scene under the first is two loading screens.
  if (scene && b.html && scene.dataset.from !== b.from) {
    const clean = safeScene(b.html);
    if (clean) {
      scene.innerHTML = clean;
      scene.dataset.from = b.from || 'course';
    }
  }
  const line = boot.querySelector('#boot-line');
  if (line && b.line) line.textContent = b.line;
}

function readBootCache(id) {
  try {
    const raw = localStorage.getItem(MUNIN.bootKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeBootCache(id, b) {
  try {
    localStorage.setItem(MUNIN.bootKey(id), JSON.stringify(b));
  } catch (e) {
    // A full quota is not a reason to fail to boot; the scene simply arrives
    // late next time, exactly as it does on a first visit.
  }
}

/** The scene the course about to open drew last time, before the first paint. */
function replayBoot(id) {
  if (!id || !(MUNIN.idOk(id) || isLocal(id))) return;
  applyBoot(readBootCache(id));
}

/* Cheap content stamp, so a redrawn scene swaps in the moment it arrives
 * instead of one visit later, and an unchanged one never re-renders. */
function stamp(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** A course's own loading screen, fetched and kept for next time. */
async function loadBootScene(c) {
  if (isLocal(c.id)) return;                       // an imported deck has no files
  try {
    const [html, css] = await Promise.all([
      fetch(c.base + 'boot.html', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')),
      fetch(c.base + 'boot.css', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : '')),
    ]);
    if (!html) return;                             // no scene of its own: Munin's raven stays
    const b = {
      html, css, line: c.boot.line, accent: c.accent,
      from: c.id + '-' + stamp(html + css),
    };
    applyBoot(b);
    writeBootCache(c.id, b);
  } catch (e) {
    // Offline, or a course that ships no scene. The default is already drawn.
  }
}

/** Everything a course needs once its theme is in hand. */
async function startCourse(c, loadDoodles) {
  globalThis.COURSE = c;
  injectAccent(c.accent);
  const line = document.getElementById('boot-line');
  if (line && c.boot.line) line.textContent = c.boot.line;
  document.title = 'Munin — ' + c.title;
  // A course that draws figures brings the stylesheet for them: its own nouns
  // — rigging, fenders, pontoons — used to be fifty rules in app.css, applied
  // over every deck including the ones about German verbs.
  if (c.figures && !c.deck) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = c.base + 'figures.css';
    document.head.appendChild(link);
  }
  const scene = loadBootScene(c);
  await loadDoodles();
  // A course with no scene file of its own still gets its own drawing in
  // Munin's frame, rather than the raven belonging to another deck.
  const holder = document.querySelector('#boot-scene[data-from="munin"] path');
  if (holder && globalThis.DOODLE && DOODLE[c.boot.art]) holder.setAttribute('d', DOODLE[c.boot.art]);
  await loadScript('app.js');
  const h1 = document.getElementById('course-title');
  if (h1) {
    // What the header calls this course is the course's own business:
    // course.json's `short`, falling back to its full title. The shell used to
    // strip one awarding body's prefix with a regular expression, which is a
    // course's naming convention living in the engine.
    h1.textContent = c.short || c.title;
    // Munin lowercases its own chrome. A deck someone imported is titled in
    // their words, not Munin's, and the shelf already shows it as written.
    h1.classList.toggle('own', !!c.deck);
  }
  mountShelfButton(c);
  await scene;
}

async function bootCourse(id) {
  const base = 'courses/' + id + '/';
  const r = await fetch(base + 'course.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('no course at ' + base);
  const c = withDefaults(await r.json());
  c.base = base;
  // The folder is the identity. course.json may name an id of its own and it
  // is ignored here: the two used to be able to disagree, and progress is
  // keyed on this — a folder renamed without editing its json silently forked
  // every user's history into a key nothing reads again.
  c.id = id;
  // A course with no doodles.js gets the raven set — a slot is never a hole.
  await startCourse(c, () => loadScript(base + 'doodles.js')
    .catch(() => { globalThis.DOODLE = MUNIN_DOODLE; }));
}

/* A deck someone imported. It has no folder and no files: the cards are in
 * IndexedDB and its pictures are blobs, so the shell hands app.js the deck
 * itself rather than a path to fetch. It brings no theme of its own, so
 * withDefaults dresses it entirely in Munin's — the same fallback any course
 * gets for the slots it leaves empty. */
async function bootLocal(id) {
  const store = await import('./lib/store.js');
  const rec = await store.get(id);
  if (!rec) throw new Error('that deck is not here any more');

  const urls = await store.mediaUrls(id);
  if (urls.size) {
    const swap = (html) => String(html).replace(/munin-media:(\d+)/g,
      (whole, i) => urls.get(Number(i)) || whole);
    for (const card of rec.deck.cards) { card.q = swap(card.q); card.a = swap(card.a); }
    addEventListener('pagehide', () => { for (const u of urls.values()) URL.revokeObjectURL(u); });
  }

  mountReceipt(rec);
  await startCourse(withDefaults({
    id,
    title: rec.title,
    base: '',
    boot: { art: rec.art || MUNIN.theme.boot.art, line: 'Loading your deck…' },
    sectionArt: rec.sectionArt || {},
    groupArt: rec.groupArt || {},
    deck: rec.deck,
  }), async () => { globalThis.DOODLE = MUNIN_DOODLE; });
}

/* The receipt again, on Progress.
 *
 * "Drop it, get a receipt" is worth little if the receipt is gone the moment
 * you start studying: the numbers it holds — what was dropped and why, what the
 * import changed — are exactly what you want three weeks later, when a card is
 * missing and you are trying to work out whether it ever arrived. It is already
 * stored with the deck; this only draws it. */
async function mountReceipt(rec) {
  if (!rec.receipt) return;
  try {
    const { book, ensureCss } = await import('./lib/receipt.js');
    const host = document.querySelector('#s-stats .body');
    if (!host) return;
    ensureCss();
    const h = document.createElement('h2');
    h.className = 'h-sect';
    h.textContent = 'Where this deck came from';
    const box = document.createElement('div');
    box.innerHTML = book(rec.receipt);
    const when = document.createElement('p');
    when.className = 'key';
    when.textContent = `imported ${new Date(rec.created).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric' })} from an anki package`;
    host.append(h, when, box);
  } catch (e) {
    console.error(e);
  }
}

/* ── the shelf ───────────────────────────────────────────────────────────── */

const SHELF_CSS = `
  .shelf { position: fixed; inset: 0; z-index: 90; overflow-y: auto;
    background: var(--bg); color: var(--text); padding: 28px 20px
    calc(28px + env(safe-area-inset-bottom)); display: none; }
  .shelf.on { display: block; }
  .shelf-inner { max-width: 430px; margin: 0 auto; }
  .shelf-mark { display: flex; align-items: center; gap: 10px; margin: 6px 0 4px; }
  .shelf-mark .dood { width: 34px; height: 34px; color: var(--accent); }
  .shelf-mark h1 { font-size: 1.3rem; font-weight: 500; letter-spacing: -.02em;
    margin: 0; text-transform: lowercase; }
  .shelf-mark .icon-btn { margin-left: auto; }
  .shelf-sub { color: var(--muted); font-size: .84rem; margin: 0 0 22px; }
  .shelf-tiles { display: flex; flex-direction: column; gap: 14px; }
  .shelf-tile { display: flex; align-items: center; gap: 12px; text-align: left;
    background: var(--surface); color: inherit; font: inherit; cursor: pointer;
    border: var(--bw) solid var(--stroke); border-left-width: 6px;
    border-left-color: var(--tile-accent, var(--stroke));
    border-radius: var(--r); box-shadow: var(--sh); padding: 14px 16px; min-height: var(--tap); }
  .shelf-tile .dood { width: 34px; height: 34px; flex: none; color: var(--tile-accent, var(--text)); }
  .shelf-tile b { display: block; font-weight: 500; font-size: .98rem; }
  .shelf-tile small { color: var(--muted); font-size: .8rem; text-transform: lowercase; }
  .shelf-tile.byo { border-style: dashed; border-left-width: var(--bw);
    box-shadow: none; color: var(--muted); justify-content: center; }
  /* A course that would not load. It stays on the shelf, and says so, because
   * a tile quietly missing is how you conclude your deck is gone. */
  .shelf-tile.broken { cursor: default; border-left-color: var(--stroke); }
  .shelf-tile.broken b { color: var(--muted); }
  /* An imported deck is the only thing here that can be got rid of, so it is
   * the only thing carrying a control. Two taps: the second one confirms. */
  .shelf-row { position: relative; display: flex; }
  .shelf-row .shelf-tile { flex: 1; padding-right: 52px; }
  .shelf-del { position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    min-width: 44px; min-height: 44px; background: none; border: 0; cursor: pointer;
    color: var(--muted); font: inherit; font-size: .95rem; border-radius: var(--r-sm); }
  .shelf-del[data-armed] { color: var(--accent); font-size: .74rem;
    text-transform: lowercase; min-width: 66px; }
  .shelf-install { margin-top: 26px; padding: 16px 18px 18px;
    background: var(--surface); border: var(--bw) dashed var(--stroke);
    border-radius: var(--r); }
  .shelf-install[hidden] { display: none; }
  .shelf-install b { display: block; font-weight: 500; font-size: .92rem;
    text-transform: lowercase; }
  .shelf-install p { margin: 4px 0 0; color: var(--muted); font-size: .8rem; }
  .shelf-install-steps { margin: 10px 0 0; padding-left: 20px; color: var(--text);
    font-size: .8rem; display: grid; gap: 4px; }
  .shelf-install-steps[hidden] { display: none; }
  .shelf-install-steps::marker, .shelf-install-steps li::marker { color: var(--muted); }
  #shelf-install-btn { margin-top: 12px; width: 100%; min-height: var(--tap);
    background: var(--surface); color: var(--text); font: inherit; font-size: .86rem;
    text-transform: lowercase; cursor: pointer;
    border: var(--bw) solid var(--stroke); border-radius: var(--r-sm);
    box-shadow: var(--sh-sm); }
  #shelf-install-btn[hidden] { display: none; }
  .shelf-note { margin-top: 22px; color: var(--muted); font-size: .78rem;
    text-transform: lowercase; text-align: center; }
  .shelf-btn { position: fixed; top: calc(10px + env(safe-area-inset-top)); right: 12px;
    z-index: 80; display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface); color: var(--text); font: inherit; font-size: .78rem;
    text-transform: lowercase; cursor: pointer; border: var(--bw) solid var(--stroke);
    border-radius: 99px; box-shadow: var(--sh-sm); padding: 5px 12px; }
  .shelf-btn .dood { width: 16px; height: 16px; }
  /* Mid-session the pill would sit on the study header; a session is not the
   * moment to change course anyway. Home, Browse and Progress keep it. */
  body:has(#s-study:not([hidden])) .shelf-btn { display: none; }`;

let shelfCssOn = false;
function ensureShelfCss() {
  if (shelfCssOn) return;
  shelfCssOn = true;
  const style = document.createElement('style');
  style.textContent = SHELF_CSS;
  document.head.appendChild(style);
}

const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Which courses ship with the app. One list, read at runtime: it used to be a
 * literal in this file, a second literal in the service worker's precache and
 * a third in refresh-courses.sh, and a course missing from the second worked
 * online and 404'd offline — the failure you find last.
 *
 * One shape: `{ "courses": [...] }`. This used to also accept a bare array,
 * which none of the three scripts that read the same file accept — tolerance
 * two readers out of five honour is a way to write a file that half the
 * toolchain rejects. */
async function readRegistry() {
  const r = await fetchWithTimeout(MUNIN.registry);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const idx = await r.json();
  if (!idx || !Array.isArray(idx.courses)) throw new Error('no course list in ' + MUNIN.registry);
  // A registered id that is not a usable id is a mistake in the one file that
  // says which courses exist — almost always a typo or a capital. It gets a
  // tile that says so rather than vanishing: a course quietly missing from the
  // shelf is how you conclude your deck is gone.
  const good = [], bad = [];
  for (const id of idx.courses) (MUNIN.idOk(id) ? good : bad).push(id);
  if (bad.length) console.error('not usable course ids in ' + MUNIN.registry + ':', bad);
  return { ids: good, bad: bad.map((b) => String(b).slice(0, 40)) };
}

/* Nothing the picker waits for may wait for ever. A request that hangs is not
 * a request that failed: the error paths here were all covered and a lie-fi
 * connection that never answers still left the shelf blank with no way back,
 * which is the exact failure the per-course try/catch was meant to end. */
const FETCH_MS = 8000;
function fetchWithTimeout(url, ms) {
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), ms || FETCH_MS);
  return fetch(url, { cache: 'no-cache', signal: stop.signal })
    .finally(() => clearTimeout(t));
}

/** A course's description, or null with a reason. One course cannot take the
 *  picker down: this is the whole app's front door, and a mistyped course.json
 *  used to leave a blank page with no way back to anything. */
async function courseMeta(id) {
  try {
    const r = await fetchWithTimeout('courses/' + id + '/course.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const c = withDefaults(await r.json());
    c.id = id;
    if (!c.title) throw new Error('no title');
    return c;
  } catch (e) {
    console.error('course ' + id + ':', e);
    return null;
  }
}

/* Study history, and cached loading screens, for decks that are not here.
 *
 * store.remove() deletes the state key as it goes, but the deck being removed
 * may be the one open behind this overlay, and that session writes its state
 * again on the way out — so the key comes back a moment after it was deleted,
 * owned by nothing, for ever. Collecting orphans whenever the shelf draws is
 * the only point where the full list of decks is in hand anyway.
 *
 * DELETING IS ONLY EVER DONE FROM A LIST WE ACTUALLY HAVE. `null` means the
 * question could not be answered — a database that would not open, a registry
 * that would not load — and an unanswered question is not the answer "none of
 * them exist". Getting this wrong deletes a person's study history: an empty
 * deck list in a private window swept every imported deck's progress, and an
 * unreachable registry swept every course's cached loading screen. */
function sweepOrphans(decks, courses) {
  if (decks) {
    const live = new Set(decks.map((d) => d.id));
    for (const k of Object.keys(localStorage)) {
      const s = /^munin\/(local-[a-z0-9]+)\/state\/v1$/.exec(k);
      if (s && !live.has(s[1])) localStorage.removeItem(k);
    }
  }
  if (decks && courses) {
    const known = new Set(courses.concat(decks.map((d) => d.id)));
    for (const k of Object.keys(localStorage)) {
      const b = /^munin\/boot\/(.+)$/.exec(k);
      if (b && !known.has(b[1])) localStorage.removeItem(k);
    }
  }
}

let disarmAt = 0;
function disarm(root) {
  clearTimeout(disarmAt);
  for (const b of root.querySelectorAll('[data-armed]')) {
    delete b.dataset.armed;
    b.textContent = '✕';
  }
}

/* The emblem comes out of course.json as the path itself. The shelf used to
 * fetch the whole 43 KB doodles.js and mine one path out of it with a regular
 * expression — two courses meant 86 KB of theme source parsed by the shell to
 * draw two tiles, and a doodle file that ever changed quotation marks would
 * have failed silently to a raven. */
function tileArt(path) {
  return `<svg class="dood" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${escHtml(path)}"/></svg>`;
}

function courseTile(c) {
  return `<button type="button" class="shelf-tile" data-course="${escHtml(c.id)}"
      style="--tile-accent:${escHtml(c.accent.light)}">
    ${tileArt(c.shelfPath || MUNIN_DOODLE[MUNIN.theme.fallback])}
    <span><b>${escHtml(c.title)}</b><small>${escHtml(c.tagline || '')}</small></span>
  </button>`;
}

function brokenTile(id) {
  return `<div class="shelf-tile broken">${muninDoodle('peek')}
    <span><b>${escHtml(id)}</b><small>this course would not load — reload, or check you are online</small></span>
  </div>`;
}

/* An imported deck is titled by whoever made the .apkg, so everything about it
 * on this screen is escaped. */
function localTile(d) {
  const art = MUNIN_DOODLE[d.art] || MUNIN_DOODLE[MUNIN.theme.fallback];
  return `<div class="shelf-row">
    <button type="button" class="shelf-tile" data-course="${escHtml(d.id)}"
        style="--tile-accent:${escHtml(MUNIN.theme.accent.light)}">
      ${tileArt(art)}
      <span><b>${escHtml(d.title)}</b><small>your deck · ${Number(d.cards).toLocaleString('en-GB')
      } cards · ${new Date(d.created).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></span>
    </button>
    <button type="button" class="shelf-del" data-del="${escHtml(d.id)}"
      aria-label="Remove ${escHtml(d.title)}">✕</button>
  </div>`;
}

async function renderShelf(asOverlay) {
  if (!asOverlay) {
    injectAccent(MUNIN.theme.accent);
    document.title = 'Munin';
  }
  ensureShelfCss();

  // Neither the registry nor any one course may stop the picker drawing. The
  // shelf with nothing on it but "+ your own deck" is a bad day; a blank page
  // is a broken app.
  let ids = [], bad = [], lost = false;
  try {
    ({ ids, bad } = await readRegistry());
  } catch (e) {
    console.error('course list:', e);
    lost = true;
  }
  const metas = await Promise.all(ids.map(courseMeta));

  // Imported decks, if the browser will tell us about them. A database that
  // will not open is not a reason for the shelf to fail to draw — and `null`
  // rather than `[]`, because "we could not ask" must never be swept as "you
  // have none".
  let mine = null;
  try {
    mine = await (await import('./lib/store.js')).list();
  } catch (e) {
    console.error(e);
  }
  try {
    sweepOrphans(mine, lost ? null : ids);
  } catch (e) {
    console.error(e);
  }

  const tiles = metas.map((c, i) => (c ? courseTile(c) : brokenTile(ids[i])))
    .concat(bad.map(brokenTile)).join('');
  const el = document.createElement('div');
  el.className = 'shelf on';
  el.innerHTML = `<div class="shelf-inner">
    <div class="shelf-mark">${muninDoodle('perch')}<h1>munin</h1>
      <button type="button" class="icon-btn" id="shelf-theme" aria-label="Switch colour theme"
        title="Switch colour theme"><span aria-hidden="true" data-theme-glyph>☀</span></button>
    </div>
    <p class="shelf-sub">a friendly raven who remembers for you</p>
    <div class="shelf-tiles">
      ${tiles}
      ${(mine || []).map(localTile).join('')}
      ${lost ? `<div class="shelf-tile broken">${muninDoodle('peek')}
        <span><b>the courses are not answering</b><small>reload, or check you are
        online — your own decks are unaffected</small></span></div>` : ''}
      <button type="button" class="shelf-tile byo" data-byo><span>+ your own deck</span></button>
    </div>
    <div class="shelf-install" id="shelf-install" hidden>
      <b>learn every day</b>
      <p>spacing only pays if you turn up. one tap from your home screen, and the cards work with no signal.</p>
      <ol class="shelf-install-steps"></ol>
      <button type="button" id="shelf-install-btn" hidden>install</button>
    </div>
    <p class="shelf-note">${asOverlay ? 'tap outside a tile to go back' : 'pick a course — it opens straight here next time'}</p>
  </div>`;
  document.body.appendChild(el);
  // The loading screen goes when there is something to replace it with, not
  // when we start looking. Hidden first, a registry that hangs left a blank
  // white page for as long as the request took — which is for ever, on the
  // kind of connection that hangs rather than fails.
  if (!asOverlay) {
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
  }
  el.querySelector('#shelf-theme').addEventListener('click', () => MuninTheme.cycle());
  el.querySelector('#shelf-install-btn').addEventListener('click', () => MuninInstall.prompt());
  MuninTheme.apply();
  renderShelfInstall();
  // Dismiss by clicking off the card, not by clicking anything that is not a
  // tile: the theme button and the remove button live up here too.
  if (asOverlay) el.addEventListener('click', (e) => {
    if (!e.target.closest('.shelf-inner')) el.remove();
  });

  el.addEventListener('click', async (e) => {
    const byo = e.target.closest('[data-byo]');
    if (byo) {
      const note = el.querySelector('.shelf-note');
      note.textContent = 'reading it here on your device — nothing is uploaded';
      try {
        const { openImporter } = await import('./import.js');
        openImporter();
      } catch (err) {
        console.error(err);
        note.textContent = 'the importer could not load — try again once you are online';
      }
      return;
    }

    // Removing a deck takes two taps and no dialog: the button says what the
    // next tap does. Anything else you touch puts it away again — an armed
    // delete left sitting on the shelf is how you lose the wrong deck.
    const del = e.target.closest('[data-del]');
    if (!del) disarm(el);
    if (del) {
      if (!del.dataset.armed) {
        disarm(el);
        del.dataset.armed = '1';
        del.textContent = 'remove?';
        clearTimeout(disarmAt);
        disarmAt = setTimeout(() => disarm(el), 5000);
        return;
      }
      const id = del.dataset.del;
      del.textContent = '…';
      try {
        await (await import('./lib/store.js')).remove(id);
      } catch (err) {
        console.error(err);
        del.textContent = '✕';
        return;
      }
      if (localStorage.getItem(MUNIN.lastKey) === id) localStorage.removeItem(MUNIN.lastKey);
      // If that was the deck being studied, the screen behind this overlay is
      // now a session over a deck that does not exist: answers would be written
      // to a key nothing will ever read again.
      if (globalThis.COURSE && COURSE.id === id) { location.reload(); return; }
      del.closest('.shelf-row').remove();
      return;
    }

    const tile = e.target.closest('[data-course]');
    if (!tile) return;
    if (asOverlay && tile.dataset.course === localStorage.getItem(MUNIN.lastKey)) {
      el.remove();
      return;
    }
    localStorage.setItem(MUNIN.lastKey, tile.dataset.course);
    location.reload();
  });
}

/* Inside a course: a small pill that overlays the shelf. It never clears the
 * resume state — the next cold open still lands in the last course entered. */
function mountShelfButton(c) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'shelf-btn';
  b.innerHTML = muninDoodle('perch') + '<span>courses</span>';
  b.addEventListener('click', () => renderShelf(true));
  ensureShelfCss();
  document.body.appendChild(b);
}

/* Offline is the product, so the worker is registered by the shell rather
 * than from inside a course: it used to be app.js, which never runs on the
 * picker — a visitor who landed on the shelf, read it and left had installed
 * nothing at all, including the "install" offer's own reason for existing. */
function registerWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(function main() {
  MuninTheme.apply();
  registerWorker();
  const known = (id) => MUNIN.idOk(id) || isLocal(id);
  // ?course=<id> deep-links a course, and becomes the resume target once it
  // has actually opened. Written eagerly, a stale or mistyped shared link
  // overwrote the resume pointer and the failure handler then deleted it, so
  // one tap on a dead link cost you the course you were in the middle of.
  const q = new URLSearchParams(location.search).get('course');
  const stored = localStorage.getItem(MUNIN.lastKey);
  const target = q && known(q) ? q : stored;

  // The scene is replayed for whatever is actually about to open — the query
  // is read first for that reason, or a deep link paints the course you were
  // in last for as long as the new one takes to arrive.
  replayBoot(target);

  if (target && known(target)) {
    (isLocal(target) ? bootLocal(target) : bootCourse(target))
      .then(() => localStorage.setItem(MUNIN.lastKey, target))
      .catch((e) => {
        // A deck that was deleted, or a course that was renamed, sends you to
        // the shelf instead of to a dead screen. Only the stored pointer is
        // forgotten, and only if it is the thing that failed.
        console.error(e);
        if (stored === target) localStorage.removeItem(MUNIN.lastKey);
        renderShelf().catch(console.error);
      });
  } else {
    renderShelf().catch(console.error);
  }
})();
