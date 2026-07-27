/* Munin — the shell in front of the courses.
 *
 * Boot order: this file decides which course is active (localStorage), fetches
 * its course.json, injects the theme (accent vars + boot screen), then loads
 * the course's own doodles.js and finally app.js — which reads the COURSE
 * global for its deck, art maps and storage key. With no course picked it
 * renders the shelf instead and app.js never loads.
 *
 * Courses never share theme files: each folder under courses/ is complete in
 * itself. Two files being identical is a coincidence, not a link.
 *
 * Sync is deliberately OFF in this build. The live Day Skipper app at
 * /day-skipper shares this origin and its Supabase rows; Munin joining that
 * sync before the parity gate would corrupt real study state. DSSync below is
 * a stub with the full surface app.js touches.
 */
'use strict';

const MUNIN = {
  lastKey: 'munin/last-course',
  courses: ['day-skipper', 'competent-crew'],
  accent: { light: '#0e3f39', dark: '#35917f', inkLight: '#fffdf7', inkDark: '#141519' },
};

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
      g.textContent = t === 'auto' ? '\u25D0' : t === 'dark' ? '\u263E' : '\u2600';
    }
  },
};
globalThis.MuninTheme = MuninTheme;

function muninDoodle(name, cls, style) {
  const d = MUNIN_DOODLE[name] || MUNIN_DOODLE.perch;
  return `<svg class="dood ${cls || ''}" viewBox="0 0 32 32" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    ${style ? `style="${style}"` : ''}><path d="${d}"/></svg>`;
}

/* One <style> block per boot: the four scopes app.css declares its accent in,
 * overridden from course.json (or Munin's own ink teal on the shelf). */
function injectAccent(a) {
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

async function bootCourse(id) {
  const base = 'courses/' + id + '/';
  const r = await fetch(base + 'course.json', { cache: 'no-cache' });
  const c = await r.json();
  c.base = base;
  globalThis.COURSE = c;
  injectAccent(c.accent);
  const boot = document.getElementById('boot');
  if (boot && c.boot) {
    boot.querySelector('p').textContent = c.boot.line || 'Loading…';
    boot.style.setProperty('--boot-anim', c.boot.anim || 'sail');
  }
  document.title = 'Munin — ' + c.title;
  // A course with no doodles.js gets the raven set — a slot is never a hole.
  await loadScript(base + 'doodles.js').catch(() => { globalThis.DOODLE = MUNIN_DOODLE; });
  await loadScript('app.js');
  const h1 = document.getElementById('course-title');
  if (h1) h1.textContent = c.title.replace(/^RYA /, '');
  mountShelfButton(c);
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

function courseTile(c) {
  return `<button type="button" class="shelf-tile" data-course="${c.id}"
      style="--tile-accent:${c.accent.light}">
    <svg class="dood" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${c.shelfPath}"/></svg>
    <span><b>${c.title}</b><small>${c.tagline || ''}</small></span>
  </button>`;
}

async function renderShelf(asOverlay) {
  if (!asOverlay) {
    injectAccent(MUNIN.accent);
    document.title = 'Munin';
    const boot = document.getElementById('boot');
    if (boot) boot.hidden = true;
  }
  ensureShelfCss();

  const metas = await Promise.all(MUNIN.courses.map(async (id) => {
    const c = await (await fetch('courses/' + id + '/course.json', { cache: 'no-cache' })).json();
    // The shelf draws each course's emblem from that course's OWN doodle file —
    // fetched as text, mined for the one path — so the shelf never links themes.
    const js = await (await fetch('courses/' + id + '/doodles.js', { cache: 'no-cache' })).text();
    const m = js.match(new RegExp("\\b" + c.shelfArt + ": '([^']*)'"));
    c.shelfPath = m ? m[1] : MUNIN_DOODLE.perch;
    return c;
  }));

  const el = document.createElement('div');
  el.className = 'shelf on';
  el.innerHTML = `<div class="shelf-inner">
    <div class="shelf-mark">${muninDoodle('perch')}<h1>munin</h1>
      <button type="button" class="icon-btn" id="shelf-theme" aria-label="Switch colour theme"
        title="Switch colour theme"><span aria-hidden="true" data-theme-glyph>\u2600</span></button>
    </div>
    <p class="shelf-sub">a friendly raven who remembers for you</p>
    <div class="shelf-tiles">
      ${metas.map(courseTile).join('')}
      <button type="button" class="shelf-tile byo" data-byo><span>+ your own deck</span></button>
    </div>
    <p class="shelf-note">${asOverlay ? 'tap outside a tile to go back' : 'pick a course — it opens straight here next time'}</p>
  </div>`;
  document.body.appendChild(el);
  el.querySelector('#shelf-theme').addEventListener('click', () => MuninTheme.cycle());
  MuninTheme.apply();
  if (asOverlay) el.addEventListener('click', (e) => {
    if (!e.target.closest('.shelf-tile')) el.remove();
  });

  el.addEventListener('click', (e) => {
    const byo = e.target.closest('[data-byo]');
    if (byo) {
      const note = el.querySelector('.shelf-note');
      note.textContent = 'importing your own deck (.apkg) arrives in phase 3';
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

(function main() {
  MuninTheme.apply();
  // ?course=<id> deep-links a course and becomes the resume target.
  const q = new URLSearchParams(location.search).get('course');
  if (q && MUNIN.courses.includes(q)) localStorage.setItem(MUNIN.lastKey, q);
  const last = localStorage.getItem(MUNIN.lastKey);
  if (last && MUNIN.courses.includes(last)) {
    bootCourse(last).catch((e) => {
      console.error(e);
      localStorage.removeItem(MUNIN.lastKey);
      renderShelf();
    });
  } else {
    renderShelf();
  }
})();
