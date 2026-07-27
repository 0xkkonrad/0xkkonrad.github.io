/* RYA Day Skipper flashcards.
 *
 * No dependencies, no network after first load. Review history lives in
 * localStorage under one key, so it survives reloads but never leaves the device.
 *
 * Scheduling is SM-2 with the awkward parts removed: two learning steps, four
 * grades, ease clamped to a sane band, and a session-local relearn queue so a
 * card you got wrong comes back a few cards later instead of on a wall clock.
 */
'use strict';

const KEY = 'rya-ds/v1';
const DAY = 86400000;
const MIN_EASE = 1.3, MAX_EASE = 2.8, MAX_IVL = 400;
// Three lapses, not Anki's six: six never fires inside a few weeks of revision,
// so the warning would arrive after the exam it was meant to prevent.
const LEECH_AT = 3;
// How many cards a deliberate "study ahead" or "no cards due in this section"
// session serves. Unbounded, it hands over the entire remaining deck.
const AHEAD_BATCH = 20;
// Stamped into every exported file so restore can tell a real backup from any
// other JSON someone happens to pick.
const EXPORT_APP = 'rya-day-skipper';
const EXPORT_FORMAT = 1;
// The exam this deck was built for. A fresh install starts here rather than
// asking; it is changed in Progress, and clearing it goes back to plain spacing.
const EXAM_DEFAULT = '2026-09-12';
// A <input type="date"> fires `change` on every keystroke in the year segment,
// so typing 2026 walks through 0002, 0020 and 0202 on its way. Anything outside
// this window is someone mid-keystroke, not a date they mean.
const EXAM_MIN_YEAR = 2020, EXAM_MAX_YEAR = 2040;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ─────────────────────────── doodles ─────────────────────────── */

/* Every drawing in the app, as one path set each, stroked in currentColor.
 * Inline rather than files: they are a few hundred bytes, they have to inherit
 * the theme colour, and an <img> would want a second copy for dark mode. */
const DOODLE = {
  boat: 'M4 22c6 3.6 18 3.6 24 0l-2.6 4.6c-5.6 2.4-13.2 2.4-18.8 0z M16 3v19 M17.4 5.6c6.2 4.8 8 11 7.4 16.4h-7.4z M14.6 8.4c-4.6 3.6-6.4 9-6 13.6h6z',
  buoy: 'M16 27V13 M10.4 13h11.2l-1.8 7.4h-7.6z M12 4.6l-2.4-2 M20 4.6l2.4-2',
  anchor: 'M16 8.2v18.6 M9.6 12.4h12.8 M6.4 18.6c.4 6.4 4.6 9 9.6 9s9.2-2.6 9.6-9 M4.4 19.8l2-1.2 2 1.4 M27.6 19.8l-2-1.2-2 1.4',
  wave: 'M2 12c3.4-4.4 6.6-4.4 10 0s6.6 4.4 10 0 6.6-4.4 8-1.6 M2 19c3.4-4.4 6.6-4.4 10 0s6.6 4.4 10 0 6.6-4.4 8-1.6',
  gull: 'M3 16c4.6-6.4 9-6.4 12.4 0 M15.4 16c3.4-6.4 7.8-6.4 12.4 0',
  lighthouse: 'M11.4 28h9.2l-1.8-13.4h-5.6z M12.6 7.4h6.8l.8 7.2h-8.4z M16 3.2v4.2 M22.6 9.4l5-2.6 M9.4 9.4l-5-2.6 M12.4 21.4h7.2',
  knot: 'M11 22c-6.6-4.8-4.4-14 5-14s11.6 9.2 5 14 M9.6 12.4c5 5.4 7.8 5.4 12.8 0 M11 22l-3 6 M21 22l3 6',
  fish: 'M4 16c5-6.4 12-6.4 17 0-5 6.4-12 6.4-17 0z M21 16l6-4.6v9.2z',
  compass: 'M16 2.6l3.2 10.2L29.4 16l-10.2 3.2L16 29.4l-3.2-10.2L2.6 16l10.2-3.2z',
  wheel: 'M16 5.6v20.8 M5.6 16h20.8 M8.6 8.6l14.8 14.8 M23.4 8.6L8.6 23.4',
  moon: 'M21.4 4.6a12 12 0 1 0 6 15.4 9.6 9.6 0 0 1-6-15.4z M25.4 6.4l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z',
  sun: 'M16 3v4 M16 25v4 M3 16h4 M25 16h4 M7 7l2.8 2.8 M22.2 22.2 25 25 M25 7l-2.8 2.8 M9.8 22.2 7 25',
  chart: 'M4 8.4c4-2.4 8-2.4 12 0s8 2.4 12 0v15.2c-4 2.4-8 2.4-12 0s-8-2.4-12 0z M16 8.4v15.2 M4 16c4-2.4 8-2.4 12 0s8 2.4 12 0',
  flag: 'M8 28V4 M8 5.4h16l-3.4 5 3.4 5H8',
  lifering: 'M16 5.6v4.4 M16 22v4.4 M5.6 16H10 M22 16h4.4',
  crossing: 'M6 27c3 1.6 7 1.6 10 0l-1.2 3c-2.6 1.2-5 1.2-7.6 0z M11 8v19 M12 10c3.4 2.6 4.4 6.6 4 11h-4z M20 17c2.4 1.2 5.6 1.2 8 0l-1 2.4c-2 1-4 1-6 0z M24 6v11 M25 7.6c2.6 2 3.4 5 3 8.4h-3z',
  lamp: 'M12 26h8 M13 14h6l1 12h-8z M13 14V9h6v5 M16 9V5 M23 8l4-2.4 M9 8L5 5.6 M24 15h4 M8 15H4',
  horn: 'M5 13h6l10-6v18l-10-6H5z M5 13v6 M24 11c2.4 3 2.4 7 0 10 M27.4 8c3.4 4.6 3.4 11.4 0 16',
  dividers: 'M16 5.6v3 M15 8.6 8 26.4 M17 8.6 24 26.4 M11.2 18.6h9.6 M8 26.4l-1.6 2.4 M24 26.4l1.6 2.4',
  plotter: 'M4 24h24L4 8z M9.6 21.4v-6 M14.6 21.4v-4 M19.6 21.4v-2',
  current: 'M2 11c3.4-4.2 6.6-4.2 10 0s6.6 4.2 10 0 6.4-4 8-1.6 M2 20c3.4-4.2 6.6-4.2 10 0s6.6 4.2 10 0 6.4-4 8-1.6 M26 6.4 30 9.4l-4 3 M26 15.4l4 3-4 3',
  flash: 'M16 4v6 M16 22v6 M4.6 16h6 M21.4 16h6 M8 8l4 4 M20 20l4 4 M24 8l-4 4 M12 20l-4 4',
  cloud: 'M10 22a5.4 5.4 0 0 1 0-10.8 7.4 7.4 0 0 1 14-1.6 5.2 5.2 0 0 1-1.4 12.4z M11 25.4l-1.4 3 M17 25.4l-1.4 3 M23 25.4l-1.4 3',
  fogbank: 'M4 22c5 2.6 15 2.6 20 0l-2 4c-4.6 2-11.4 2-16 0z M14 6v16 M15.4 8c4.6 3.6 6 8.2 5.6 12.4h-5.6z M2 12h8 M18 12h12 M2 17h5 M24 17h6',
  flare: 'M16 28V15 M11.6 15h8.8L16 4z M13 20.6l-4 4 M19 20.6l4 4 M9.4 12 5 9.4 M22.6 12 27 9.4',
  propeller: 'M16 13.4c-3.4-4.6-8.6-6.6-11-4.4s0 7.4 5 10 M16 13.4c4.4-3.6 10-4 11.4-1s-2.6 7-8.2 8.2 M16 18.6c-1 5.6 1 10.6 4.2 10.6',
  route: 'M5 26.4 11 17l5 4 6-11.4 M24 5.6v9 M24 6.4h5l-2 2.4 2 2.4h-5',
  radar: 'M16 16 24 8 M16 16v11.4 M9 9l3 3 M23 9l-3 3 M9 23l3-3',
};
/* Circles cannot live in a path list, so the few doodles that need one carry it
   separately rather than being approximated with four arcs. */
const DOODLE_DOTS = {
  lifering: [[16, 16, 10.4], [16, 16, 5.2]],
  lamp: [[16, 11.4, 1.4]],
  flash: [[16, 16, 4.6]],
  propeller: [[16, 16, 2.4]],
  radar: [[16, 16, 12], [16, 16, 6], [20.4, 11.6, 1.4]],
  route: [[5, 26.4, 1.6], [11, 17, 1.4], [16, 21, 1.4]],
  buoy: [[16, 8.6, 2.6]],
  anchor: [[16, 5.4, 2.8]],
  fish: [[9.6, 14.6, 1.1]],
  compass: [[16, 16, 13]],
  wheel: [[16, 16, 10.4]],
  sun: [[16, 16, 5.4]],
};

/* The drawing goes inside a sized wrapper rather than being sized itself: an
 * <svg> that is a flex item ignores its own width and fills the slot, which put
 * ten 48px-tall boats across a 320px screen the first time this shipped. */
function doodle(name, cls, style) {
  const d = DOODLE[name] || DOODLE.boat;
  const dots = (DOODLE_DOTS[name] || [])
    .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
  return `<span class="dood ${cls || ''}"${style ? ` style="${style}"` : ''} aria-hidden="true">`
    + `<svg class="doodle" viewBox="0 0 32 32">${dots}<path d="${d}"/></svg></span>`;
}

let DECK = null;                 // cards.json
let FIGURES = null;              // figures.json — the labelled doodles
let byId = new Map();
let sectionOf = new Map();       // section key -> {t, n}
let state = null;
let session = null;
let undoStack = [];

/* ─────────────────────────── storage ─────────────────────────── */

function freshState() {
  return {
    v: 1,
    recs: {},                    // card id -> {st, step, ivl, ea, due, rp, lp}
    day: dayKey(Date.now()),
    newDone: 0,
    revDone: 0,
    streak: 0,
    lastDay: null,
    days: {},                    // dayKey -> answers, for the streak
    revTotal: 0,
    revGood: 0,
    answers: 0,                  // every grade ever, for the ship's log
    ach: {},                     // achievement id -> unlocked timestamp
    // Light by default rather than following the system: the paper, the ink
    // outlines and the hard shadows are the design, and the derived dark set is
    // the fallback for people who go looking for it.
    settings: { newPerDay: 20, maxRev: 120, shuffle: true, theme: 'light', examDate: EXAM_DEFAULT, examSkipped: false },
  };
}

/* Numbers interpolated into innerHTML are coerced, not trusted: a restored
 * backup is the one place a string can reach these templates. */
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Make any stored or imported blob safe to run on.
 *
 * Everything here has been seen to break the app for real: a value missing
 * `days` threw on the first answer and wrote itself back, `recs` as a string
 * made boot throw before the loading screen came down, and a non-numeric
 * interval produced a NaN due date that removed a card from scheduling for
 * good. Trust nothing that came out of storage or off disk. */
function sanitise(raw) {
  const base = freshState();
  if (!isPlainObject(raw)) return base;
  const s = Object.assign(base, raw);
  s.settings = Object.assign(freshState().settings, isPlainObject(raw.settings) ? raw.settings : {});

  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  s.settings.newPerDay = Math.round(num(s.settings.newPerDay, 0, 200, 20));
  s.settings.maxRev = Math.round(num(s.settings.maxRev, 10, 999, 120));
  s.settings.shuffle = !!s.settings.shuffle;
  s.settings.examSkipped = !!s.settings.examSkipped;
  if (!['auto', 'light', 'dark'].includes(s.settings.theme)) s.settings.theme = 'auto';
  // The default exam date belongs to a fresh install only. A restored backup
  // that never had one must not silently inherit it — that would compress every
  // interval on someone else's deck the moment they imported it.
  const rawExam = isPlainObject(raw.settings) ? raw.settings.examDate : undefined;
  if (typeof rawExam !== 'string') s.settings.examDate = '';
  if (typeof s.settings.examDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.settings.examDate)) {
    s.settings.examDate = '';
  }

  const recs = {};
  if (isPlainObject(raw.recs)) {
    for (const [id, r] of Object.entries(raw.recs)) {
      if (!isPlainObject(r)) continue;
      const st = r.st === 'r' ? 'r' : 'l';
      recs[id] = {
        st,
        step: Math.round(num(r.step, 0, 9, 0)),
        ivl: Math.round(num(r.ivl, 0, MAX_IVL, st === 'r' ? 1 : 0)),
        ea: num(r.ea, MIN_EASE, MAX_EASE, 2.5),
        due: num(r.due, 0, 8.64e15, Date.now()),
        rp: Math.round(num(r.rp, 0, 1e6, 0)),
        lp: Math.round(num(r.lp, 0, 1e6, 0)),
        pv: Math.round(num(r.pv, 0, MAX_IVL, 0)),
      };
    }
  }
  s.recs = recs;
  s.days = isPlainObject(raw.days) ? raw.days : {};
  for (const [k, v] of Object.entries(s.days)) {
    if (!Number.isFinite(Number(v))) delete s.days[k]; else s.days[k] = Math.round(Number(v));
  }
  s.streak = Math.round(num(s.streak, 0, 1e5, 0));
  s.newDone = Math.round(num(s.newDone, 0, 1e6, 0));
  s.revDone = Math.round(num(s.revDone, 0, 1e6, 0));
  s.revTotal = Math.round(num(s.revTotal, 0, 1e9, 0));
  s.revGood = Math.round(num(s.revGood, 0, s.revTotal, 0));

  // An older save has no lifetime counter. Sum the day history rather than
  // starting at zero, or upgrading resets the ship's log for everyone.
  s.answers = Math.round(num(
    raw.answers,
    0, 1e9,
    Object.values(s.days).reduce((t, v) => t + Number(v || 0), 0)
  ));
  // Only ids this build knows about, and only real timestamps: an unlock date of
  // "yes" renders as Invalid Date in the log for ever.
  const ach = {};
  if (isPlainObject(raw.ach)) {
    for (const [id, ts] of Object.entries(raw.ach)) {
      if (!ACH_IDS.has(id)) continue;
      const t = Number(ts);
      if (Number.isFinite(t) && t > 0) ach[id] = Math.round(t);
    }
  }
  s.ach = ach;
  if (typeof s.day !== 'string') s.day = dayKey(Date.now());
  if (typeof s.lastDay !== 'string') s.lastDay = null;
  return s;
}

function load() {
  let s = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) s = JSON.parse(raw);
  } catch (e) {
    console.warn('progress unreadable, starting fresh', e);
  }
  state = sanitise(s);
  rollDay();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 250);
}
function writeNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save progress — device storage is full or blocked.');
  }
}
addEventListener('pagehide', writeNow);
addEventListener('visibilitychange', () => { if (document.hidden) writeNow(); });

/* Two tabs on the same deck used to overwrite each other silently — whichever
 * saved last won, and the other tab's answers were gone. Adopt the other tab's
 * state unless we are mid-session, in which case say so rather than yanking the
 * card out from under the reader. */
addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue || !DECK) return;
  let incoming;
  try { incoming = JSON.parse(e.newValue); } catch (err) { return; }
  if (session) {
    toast('Another tab is studying this deck. Close one, or your progress will not add up.');
    return;
  }
  state = sanitise(incoming);
  for (const id of Object.keys(state.recs)) if (!byId.has(id)) delete state.recs[id];
  applyTheme();
  if (current === 'home') renderHome();
  if (current === 'stats') renderStats();
  if (current === 'browse') renderBrowse();
});

/* ─────────────────────────── dates ─────────────────────────── */

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Yesterday's key, worked out on the calendar rather than by subtracting 24
 *  hours — on the two clock-change days a year, 24 hours ago is either still
 *  today or the day before yesterday, and the streak resets for no reason. */
function yesterdayKey() {
  const d = new Date(Date.now());
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** Roll the per-day counters over, and keep the streak honest. */
function rollDay() {
  const today = dayKey(Date.now());
  if (state.day === today) return;
  state.day = today;
  state.newDone = 0;
  state.revDone = 0;
  // a streak survives one calendar day's gap only
  if (state.lastDay !== yesterdayKey() && state.lastDay !== today) state.streak = 0;
  save();
}

function countStudiedToday() {
  return state.days[state.day] || 0;
}

function noteAnswered() {
  const t = state.day;
  state.days[t] = (state.days[t] || 0) + 1;
  state.answers = n(state.answers) + 1;
  if (state.lastDay !== t) {
    state.streak = state.lastDay === yesterdayKey() ? state.streak + 1 : 1;
    state.lastDay = t;
  }
  // 90 days is more history than the stats screen shows; drop the rest
  const keys = Object.keys(state.days);
  if (keys.length > 120) {
    keys.sort();
    for (const k of keys.slice(0, keys.length - 90)) delete state.days[k];
  }
}

/* ─────────────────────────── scheduling ─────────────────────────── */

function newRec() {
  // pv = the interval a relapsed card gets back when it re-graduates
  return { st: 'l', step: 0, ivl: 0, ea: 2.5, due: 0, rp: 0, lp: 0, pv: 0 };
}

/** New cards to introduce today.
 *
 * With an exam date set, the manual figure is a floor rather than the answer:
 * 20 a day gets through 537 cards in 27 days, so if the exam is in three weeks
 * a fifth of the deck would never be seen once. Aim to finish introducing by
 * 60% of the way to the date, leaving the rest of the run for review. */
function newBudget() {
  const manual = state.settings.newPerDay;
  const d = daysToExam();
  if (d === null || d <= 0) return manual;
  const unseen = DECK ? DECK.cards.filter((c) => !state.recs[c.i]).length : 0;
  if (!unseen) return manual;
  return Math.max(manual, Math.ceil(unseen / Math.max(1, Math.round(d * 0.6))));
}

/** Whole days from today to the exam, or null if no date is set. */
function daysToExam() {
  const d = state.settings.examDate;
  if (!d) return null;
  const t = Date.parse(d + 'T00:00:00');
  if (Number.isNaN(t)) return null;
  return Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
}

function fuzz(days) {
  if (days < 3) return days;
  const spread = Math.max(1, Math.round(days * 0.05));
  return days + (Math.floor(Math.random() * (spread * 2 + 1)) - spread);
}

/** The longest interval allowed right now — shortened once an exam date is set.
 *
 * Cepeda et al. (2008) put the best gap at roughly 10–20% of the interval you
 * need to remember over. Studying for a date, that interval is the days left,
 * so a card scheduled past the exam is a card you have stopped revising. */
function ceiling() {
  const d = daysToExam();
  // A date in the past is a typo or an exam already sat. Either way it must not
  // cap anything: `Math.round(-300 * 0.2)` floors to 1 day and makes the whole
  // deck due daily, for ever, with no way back.
  if (d === null || d < 0) return MAX_IVL;
  return Math.max(1, Math.min(MAX_IVL, Math.round(d * 0.2)));
}

/** What the next interval would be, in days. 0 means "again this session". */
function preview(rec, g) {
  const cap = ceiling();
  const lim = (d) => Math.min(cap, MAX_IVL, d);
  if (!rec || rec.st === 'l') {
    if (g === 1) return 0;
    // Hard keeps a card in the session, but not forever: three goes and it
    // leaves, otherwise a card you keep calling hard never ends.
    if (g === 2) return (rec && rec.step >= 2) ? lim(rec.pv || 1) : 0;
    if (g === 3) return lim((rec && rec.pv) || 1);
    return lim(rec && rec.pv ? Math.max(rec.pv, 2) : 4);
  }
  const ea = rec.ea;
  // Again sends a review card back into this session; the interval it comes out
  // with is decided when it graduates, so there is no number to promise here.
  if (g === 1) return 0;
  // Hard holds the interval where it is. Growing it — which plain SM-2 does —
  // means a card you always find hard drifts out to months and stops being
  // revised at all, which is the opposite of what "hard" is telling you.
  if (g === 2) return lim(Math.max(1, rec.ivl));
  if (g === 3) return lim(Math.max(rec.ivl + 1, Math.round(rec.ivl * ea)));
  return lim(Math.max(rec.ivl + 2, Math.round(rec.ivl * ea * 1.3)));
}

/** Apply a grade. Returns 'stay' if the card should come back this session. */
function grade(id, g) {
  const rec = state.recs[id] || newRec();
  const isNew = !state.recs[id];
  const wasReview = rec.st === 'r';
  state.recs[id] = rec;
  rec.rp++;

  if (wasReview) {
    state.revTotal++;
    if (g > 1) state.revGood++;
  }

  let outcome = 'done';
  let jitter = true;

  if (rec.st === 'l') {
    const out = preview(rec, g);
    if (g === 1) { rec.step = 0; outcome = 'stay'; }
    else if (g === 2 && rec.step < 2) { rec.step++; outcome = 'stay'; }
    else { rec.st = 'r'; rec.ivl = out; rec.pv = 0; }
  } else {
    if (g === 1) {
      rec.lp++;
      rec.ea = Math.max(MIN_EASE, rec.ea - 0.2);
      // Remember 40% of the interval so re-graduating restores most of what was
      // learned instead of dropping the card back to one day. Losing six good
      // reviews over one slip is a punishment nobody has time for.
      rec.pv = Math.max(1, Math.round(rec.ivl * 0.4));
      rec.st = 'l';
      rec.step = 1;
      outcome = 'stay';
    } else {
      // The interval is computed from the ease the button was *labelled* with,
      // then the ease moves. Bumping first made Easy schedule a day further out
      // than the button had just promised.
      rec.ivl = preview(rec, g);
      // Hard means "leave the gap where it is". Fuzzing an unchanged interval
      // turns that into a random walk that drifts over repeated presses; the
      // jitter is only there to break up clumps of cards scheduled together.
      if (g === 2) jitter = false;
      if (g === 2) rec.ea = Math.max(MIN_EASE, rec.ea - 0.15);
      if (g === 4) rec.ea = Math.min(MAX_EASE, rec.ea + 0.15);
    }
  }

  if (rec.st === 'r') {
    rec.ivl = Math.min(ceiling(), MAX_IVL, Math.max(1, jitter ? fuzz(rec.ivl) : rec.ivl));
    rec.due = startOfDay(Date.now() + rec.ivl * DAY);
  } else {
    // A learning card is ordered by the session queue, not the clock — but it
    // still needs a real due date, or a session abandoned half way leaves cards
    // that are permanently "due now" and invisible to the forecast.
    rec.due = startOfDay(Date.now() + DAY);
  }

  if (isNew) state.newDone++;
  else if (wasReview) state.revDone++;
  noteAnswered();
  save();
  return outcome;
}

/* One vocabulary everywhere. The Progress screen used to say "known well" for
 * the same thing the study chip called "mature". */
const STATE_WORDS = {
  new: 'not seen before',
  learning: 'still learning',
  young: 'bedding in',
  mature: 'known well',
};

function stateOf(id) {
  const r = state.recs[id];
  if (!r) return 'new';
  if (r.st === 'l') return 'learning';
  return r.ivl >= 21 ? 'mature' : 'young';
}

function isDue(id, now) {
  const r = state.recs[id];
  return !!r && r.st === 'r' && r.due <= now;
}

function counts(sectionKey) {
  const now = Date.now();
  let due = 0, fresh = 0, learning = 0, seen = 0, mature = 0;
  for (const c of DECK.cards) {
    if (sectionKey && c.s !== sectionKey) continue;
    const r = state.recs[c.i];
    if (!r) { fresh++; continue; }
    seen++;
    if (r.st === 'l') learning++;
    else {
      if (r.ivl >= 21) mature++;
      if (r.due <= now) due++;
    }
  }
  return { due, fresh, learning, seen, mature };
}

/* ─────────────────────────── video ─────────────────────────── */

/* 54 Maritime Master clips, attached to the 58 cards they plainly answer.
 * They are hosted with the app but never precached: the shell is 2.6 MB and
 * has to stay openable on no signal, so a clip is only fetched when someone
 * asks for it. Every failure mode here ends in "no video on this card", never
 * in a broken card. */
let VIDEOS = { clips: {}, cards: {}, credit: null };

const clipsFor = (cardId) => (VIDEOS.cards[cardId] || [])
  .map((c) => VIDEOS.clips[c]).filter(Boolean);

function fmtClock(sec) {
  const s = Math.max(0, Math.round(n(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* Poster frames come from the clip itself at t=1s rather than 54 extra image
 * files: preload="metadata" fetches a few tens of KB, not the video. */
function thumbHtml(clip, label) {
  return `<button class="vthumb" data-clip="${escapeHtml(clip.f)}"
      aria-label="Play ${escapeHtml(label || clip.t)} — ${fmtClock(clip.d)}">
    <video src="video/${escapeHtml(clip.f)}#t=1" muted playsinline preload="metadata"></video>
    <span class="vplay" aria-hidden="true">▶</span>
    <span class="vlen">${fmtClock(clip.d)}</span>
  </button>`;
}

function playerHtml(clip) {
  const by = VIDEOS.credit ? VIDEOS.credit.name : 'Maritime Master';
  // The credit row lives outside the black box so the box wraps the picture
  // exactly — inside, its own text was setting the player's width.
  return `<div class="vplayer">
    <video src="video/${escapeHtml(clip.f)}" playsinline controls autoplay preload="auto"></video>
  </div>
  <div class="vbar">
    <span class="vby">${escapeHtml(by)}${clip.u
      ? ` · <a href="${escapeHtml(clip.u)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</span>
    <button class="link-btn" data-collapse type="button">close</button>
  </div>
  <p class="vcap">${escapeHtml(clip.t)}</p>`;
}

/** The clips for the card on screen, under the answer. */
/* Draw the card's labelled doodle, if it has one.
 *
 * The drawing is authored once in src/figures.py and reused across the cards
 * that share it; `card.f.on` says which labels this card is asking about, and
 * everything else on the drawing dims to context. With no `on` list every
 * label lights, which is what a card wanting the whole picture means.
 *
 * The SVG body is trusted markup from the build, not user content, which is
 * why it can go in as innerHTML — the same contract as the card text. */
function figureSVG(card, cls) {
  const def = FIGURES && FIGURES[card.f.n];
  if (!def) return '';
  return `<svg class="figure${cls ? ' ' + cls : ''}" viewBox="${def.vb}" role="img"`
    + ` aria-label="${escAttr(figureAlt(card, def))}">${def.b}</svg>`;
}

/* Light the labels this card asked for. Everything else on the drawing stays,
   dimmed — that is what lets one drawing serve several cards. */
function litFigure(root, card) {
  const on = card.f.on && card.f.on.length ? new Set(card.f.on) : null;
  root.querySelectorAll('[data-l]').forEach((el) => {
    el.classList.toggle('on', !on || on.has(el.getAttribute('data-l')));
  });
}

function renderCardFigure(card) {
  const box = $('#card-figure');
  const def = card && card.f && FIGURES && FIGURES[card.f.n];
  if (!def) {
    box.hidden = true;
    $('#figure-plate').innerHTML = '';
    return;
  }
  const plate = $('#figure-plate');
  plate.innerHTML = figureSVG(card);
  litFigure(plate, card);
  plate.setAttribute('aria-label', `Enlarge the drawing: ${stripTags(card.q)}`);
  $('#figure-cap').textContent = def.cap + ' Tap to enlarge.';
  box.hidden = false;
}

/* Screen readers get the terms the card is actually asking about, not a list
   of everything drawn — the dimmed labels are context the eye skips. */
function figureAlt(card, def) {
  const spec = card.f;
  const on = (spec.on && spec.on.length ? spec.on : def.l).map((s) => s.replace(/-/g, ' '));
  return `${def.cap} Labelled: ${on.join(', ')}.`;
}

function escAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderCardVideo(card) {
  const host = $('#card-video');
  const clips = clipsFor(card.i);
  host.hidden = !clips.length;
  if (!clips.length) { host.innerHTML = ''; return; }
  // data-card is what "close" uses to rebuild the thumbnails; without it the
  // player collapsed into an empty row.
  host.innerHTML = `<p class="vhead">${clips.length === 1 ? 'A clip on this' : 'Clips on this'}</p>
    <div class="vrow" data-card="${escapeHtml(card.i)}">${clips.map((c) => thumbHtml(c)).join('')}</div>`;
}

/* One handler for both screens: a thumbnail swaps itself for a player, and the
 * player collapses back to the thumbnail. Only one plays at a time. */
function wireVideo(rootSel) {
  $(rootSel).addEventListener('click', (e) => {
    const thumb = e.target.closest('.vthumb');
    if (thumb) {
      const clip = Object.values(VIDEOS.clips).find((c) => c.f === thumb.dataset.clip);
      if (!clip) return;
      $$('.vplayer video').forEach((v) => v.pause());
      const row = thumb.closest('.vrow');
      row.dataset.open = thumb.dataset.clip;
      row.innerHTML = playerHtml(clip);
      return;
    }
    if (e.target.closest('[data-collapse]')) {
      const row = e.target.closest('.vrow');
      const cardId = row.dataset.card;
      const clips = cardId ? clipsFor(cardId) : reelClips();
      row.removeAttribute('data-open');
      row.innerHTML = clips.map((c) => thumbHtml(c)).join('');
    }
  });
}

/* ─────────────────────── the ship's log ─────────────────────── */

/* Fourteen things worth noticing. They are all side effects of revising rather
 * than tasks of their own — nothing here asks you to study differently, and
 * none of them can be earned by opening the app and putting it down again. */
const ACHIEVEMENTS = [
  { id: 'cast-off', art: 'boat', t: 'cast off', d: 'answered your first card', test: (x) => x.answers >= 1 },
  { id: 'underway', art: 'wave', t: 'underway', d: '50 cards answered', test: (x) => x.answers >= 50 },
  { id: 'offshore', art: 'lighthouse', t: 'offshore', d: '250 cards answered', test: (x) => x.answers >= 250 },
  { id: 'blue-water', art: 'chart', t: 'blue water', d: '1,000 cards answered', test: (x) => x.answers >= 1000 },
  { id: 'streak-3', art: 'gull', t: 'three days running', d: 'studied three days in a row', test: (x) => x.streak >= 3 },
  { id: 'streak-7', art: 'anchor', t: 'a week at sea', d: 'seven days in a row', test: (x) => x.streak >= 7 },
  { id: 'streak-14', art: 'compass', t: 'salt in the veins', d: 'fourteen days in a row', test: (x) => x.streak >= 14 },
  { id: 'clean-run', art: 'flag', t: 'clean run', d: '20 in a row without an again', test: (x) => x.clean >= 20 },
  { id: 'night-watch', art: 'moon', t: 'night watch', d: 'answered a card between midnight and four', test: (x) => x.hour >= 0 && x.hour < 4 },
  { id: 'dawn-patrol', art: 'sun', t: 'dawn patrol', d: 'answered a card before six in the morning', test: (x) => x.hour >= 4 && x.hour < 6 },
  { id: 'all-sections', art: 'wheel', t: 'round the buoys', d: 'started every section in the deck', test: (x) => x.sections > 0 && x.touched >= x.sections },
  { id: 'section-swept', art: 'buoy', t: 'section swept', d: 'seen every card in one section', test: (x) => x.swept >= 1 },
  { id: 'knot-untangled', art: 'knot', t: 'knot untangled', d: 'a card that kept slipping is solid again', test: (x) => x.tamed },
  { id: 'deck-met', art: 'fish', t: 'every card met', d: 'seen every card in the deck at least once', test: (x) => x.deckSeen },
];
const ACH_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

/** Everything the tests above need, worked out once per answer. 537 cards is
 *  cheap enough to walk; keeping partial counters in state would be one more
 *  thing a restored backup could contradict. */
function achContext(sess) {
  const touched = new Set();
  const seenPer = new Map();
  let seen = 0, tamed = false;
  for (const c of DECK.cards) {
    const r = state.recs[c.i];
    if (!r) continue;
    seen++;
    touched.add(c.s);
    seenPer.set(c.s, (seenPer.get(c.s) || 0) + 1);
    if (r.lp >= LEECH_AT && r.st === 'r' && r.ivl >= 7) tamed = true;
  }
  let swept = 0;
  for (const s of DECK.sections) if ((seenPer.get(s.k) || 0) >= s.n) swept++;
  return {
    answers: n(state.answers),
    streak: n(state.streak),
    hour: new Date(Date.now()).getHours(),
    clean: sess ? n(sess.maxClean) : 0,
    sections: DECK.sections.length,
    touched: touched.size,
    swept,
    tamed,
    deckSeen: seen >= DECK.cards.length,
  };
}

function checkAchievements(sess) {
  if (!DECK) return [];
  const ctx = achContext(sess);
  const now = Date.now();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (state.ach[a.id]) continue;
    let hit = false;
    try { hit = !!a.test(ctx); } catch (e) { hit = false; }
    if (hit) { state.ach[a.id] = now; fresh.push(a); }
  }
  if (fresh.length) {
    save();
    queueUnlocks(fresh);
    if (current === 'stats') renderAch();
  }
  return fresh;
}

/* Unlocks arrive one at a time. Two at once — 50 cards and a clean run on the
 * same answer — used to draw the second one straight over the first. */
let unlockQueue = [];
let unlockTimer = null;

function queueUnlocks(list) {
  unlockQueue.push(...list);
  if (!unlockTimer) showNextUnlock();
}

function showNextUnlock() {
  const el = $('#unlock');
  const a = unlockQueue.shift();
  if (!a) { unlockTimer = null; el.classList.add('away'); return; }
  $('#unlock-art').innerHTML = doodle(a.art);
  $('#unlock-title').textContent = a.t;
  $('#unlock-sub').textContent = a.d;
  el.classList.remove('away');
  // Same element, second unlock: the entry animation only replays after a reflow.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  unlockTimer = setTimeout(() => {
    el.classList.add('away');
    unlockTimer = setTimeout(showNextUnlock, 280);
  }, 3200);
}

function dismissUnlock() {
  clearTimeout(unlockTimer);
  unlockTimer = null;
  $('#unlock').classList.add('away');
  if (unlockQueue.length) unlockTimer = setTimeout(showNextUnlock, 220);
}

function renderAch() {
  const got = ACHIEVEMENTS.filter((a) => state.ach[a.id]).length;
  $('#ach-count').textContent = got
    ? `${got} of ${ACHIEVEMENTS.length} earned. They unlock as you revise — there is nothing to collect deliberately.`
    : `Nothing in the log yet. ${ACHIEVEMENTS.length} of them turn up as you revise.`;
  $('#ach-list').innerHTML = ACHIEVEMENTS.map((a) => {
    const on = state.ach[a.id];
    const when = on ? ` · ${longDate(dayKey(on))}` : '';
    return `<li class="${on ? '' : 'locked'}">${doodle(a.art)}
      <span class="a-txt"><b>${escapeHtml(a.t)}</b><small>${escapeHtml(a.d)}${escapeHtml(when)}</small></span></li>`;
  }).join('');
}

/* A drawing for each of the 24 chapters. Picked for the thing the chapter is
 * actually about — dividers for position fixing, a propeller for engines — so
 * the row is scannable once you have met it a few times. */
const SECTION_ART = {
  terms: 'boat', ropework: 'knot', anchoring: 'anchor', safety: 'lifering',
  colregs: 'crossing', lights: 'lamp', sound: 'horn', position: 'dividers',
  charts: 'chart', compass: 'compass', chartwork: 'plotter', tides: 'wave',
  streams: 'current', buoyage: 'buoy', lightchar: 'flash', meteo: 'cloud',
  pilotage: 'lighthouse', fog: 'fogbank', emergencies: 'flare', engine: 'propeller',
  handling: 'wheel', passage: 'route', electronics: 'radar', environment: 'fish',
};

/* The frieze along the top of the home screen: ten drawings, filled in as the
 * deck gets started. It is the streak and the percentage said as a picture. */
const FRIEZE_ART = ['boat', 'buoy', 'gull', 'wave', 'lighthouse', 'anchor', 'fish', 'knot', 'flag', 'compass'];

function renderFrieze() {
  const el = $('#frieze');
  if (!el || !DECK) return;
  const seen = DECK.cards.filter((c) => state.recs[c.i]).length;
  const filled = seen === 0 ? 0 : Math.max(1, Math.round((seen / DECK.cards.length) * FRIEZE_ART.length));
  el.innerHTML = FRIEZE_ART
    .map((k, i) => doodle(k, i < filled ? '' : 'unearned', `animation-delay:${(i * 0.19).toFixed(2)}s`))
    .join('');
}

/* ─────────────────────────── session ─────────────────────────── */

function buildSession(sectionKey, opts) {
  opts = opts || {};
  const now = Date.now();
  const pool = DECK.cards.filter((c) => !sectionKey || c.s === sectionKey);

  const learning = pool.filter((c) => state.recs[c.i] && state.recs[c.i].st === 'l');
  let reviews = pool.filter((c) => isDue(c.i, now));
  let fresh = pool.filter((c) => !state.recs[c.i]);

  const revRoom = Math.max(0, state.settings.maxRev - state.revDone);
  const newRoom = Math.max(0, newBudget() - state.newDone);

  if (opts.ahead) {
    // Studying ahead: pull the soonest-due cards even though they are not due yet.
    const notYet = pool
      .filter((c) => state.recs[c.i] && state.recs[c.i].st === 'r' && state.recs[c.i].due > now)
      .sort((a, b) => state.recs[a.i].due - state.recs[b.i].due)
      .slice(0, AHEAD_BATCH);
    reviews = reviews.concat(notYet);
    fresh = fresh.slice(0, AHEAD_BATCH);
  } else {
    // `slice(0, revRoom)` and not `revRoom || reviews.length`: a spent budget is
    // 0, which is falsy, and the fallback then served the entire backlog — the
    // cap vanished at exactly the moment it was supposed to bite.
    reviews = shuffle(reviews).slice(0, revRoom);
    fresh = fresh.slice(0, opts.allNew ? AHEAD_BATCH : newRoom);
  }

  const rest = shuffle(learning).concat(shuffle(reviews));
  // New cards get spread through the queue rather than dumped at one end: a run
  // of unseen cards is where sessions start to feel like a wall. Note `total` is
  // computed once — reading `rest.length` inside the loop while shifting off it
  // walks the bound down to meet the counter and drops half the session.
  const queue = [];
  const total = rest.length + fresh.length;
  const step = fresh.length ? Math.max(1, Math.round(total / fresh.length)) : 0;
  let fi = 0, ri = 0;
  for (let k = 0; k < total; k++) {
    if (step && k % step === 0 && fi < fresh.length) queue.push(fresh[fi++]);
    else if (ri < rest.length) queue.push(rest[ri++]);
    else if (fi < fresh.length) queue.push(fresh[fi++]);
  }

  if (!state.settings.shuffle && !sectionKey) {
    const order = new Map(DECK.sections.map((s, i) => [s.k, i]));
    queue.sort((a, b) => order.get(a.s) - order.get(b.s));
  }

  return {
    section: sectionKey,
    queue: queue.map((c) => c.i),
    total: queue.length,
    done: 0,
    again: 0,
    good: 0,
    startedNew: fresh.length,
    revealed: false,
    reel: [],                   // clips for the cards graded Again or Hard
    ahead: !!opts.ahead,
  };
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─────────────────────────── screens ─────────────────────────── */

const SCREENS = ['home', 'study', 'done', 'browse', 'stats'];
let current = 'home';

function go(name) {
  current = name;
  for (const s of SCREENS) $('#s-' + s).hidden = s !== name;
  $('#nav').hidden = name === 'study';
  const tab = name === 'browse' ? 'browse' : name === 'stats' ? 'stats' : 'home';
  $$('#nav button').forEach((b) => {
    const on = b.dataset.go === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (name === 'home') renderHome();
  if (name === 'stats') renderStats();
  if (name === 'browse') renderBrowse();
  const body = $('#s-' + name).querySelector('.body');
  if (body && name !== 'study') body.scrollTop = 0;
}

/* ── home ── */

/** Cards that have gone wrong enough times that answering them again is not the
 *  answer — you need to go and read the material. */
function leeches() {
  return DECK.cards.filter((c) => {
    const r = state.recs[c.i];
    return r && r.lp >= LEECH_AT;
  });
}

/** Format a yyyy-mm-dd string the way a person would say it. */
function longDate(iso) {
  const t = Date.parse(iso + 'T00:00:00');
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** How many days it takes to introduce the rest of the deck at the current pace. */
function daysToSeeAll(unseen) {
  const pace = newBudget();
  return pace > 0 ? Math.ceil(unseen / pace) : Infinity;
}

function renderAskExam(c) {
  // The exam date decides the entire daily workload, so it is asked for before
  // anything else — buried in settings, nobody ever finds it, and they walk
  // into the exam having seen half the deck.
  // Shown until a date is set or the prompt is dismissed — not just on day one.
  // Booking the exam a week in is the common case, and by then a "seen === 0"
  // prompt would be long gone with no way back to it except the third tab.
  $('#ask-exam').hidden = !!(state.settings.examDate || state.settings.examSkipped);
  $('#how').open = c.seen === 0;
}

function renderExamBanner(c) {
  const el = $('#exam-banner');
  const d = daysToExam();
  if (d === null) { el.hidden = true; return; }
  el.hidden = false;
  if (d < 0) {
    el.className = 'banner';
    el.innerHTML = `<b>Exam date has passed.</b> Clear it in Progress → Settings to go back to normal spacing.`;
    return;
  }
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
  const pace = newBudget();
  const introDays = c.fresh ? daysToSeeAll(c.fresh) : 0;
  const tight = c.fresh > 0 && introDays > Math.max(1, d);
  el.className = 'banner' + (tight ? ' tight' : '');
  el.innerHTML = tight
    ? `<b>Exam ${when}.</b> At ${pace} new cards a day, the ${c.fresh} you have not seen take ${introDays} days. You will not get through the deck — raise the daily number in Progress, or accept that you will skip some sections.`
    : `<b>Exam ${when}.</b> ${c.fresh
        ? `${pace} new cards a day gets you through the remaining ${c.fresh} in time.`
        : 'You have seen every card at least once.'} Every card comes back at least once before you sit it.`;
}

function renderLeechRow() {
  const el = $('#leech-row');
  const l = leeches();
  if (!l.length) { el.hidden = true; return; }
  el.hidden = false;
  el.querySelector('span').textContent =
    `${l.length} card${l.length === 1 ? '' : 's'} keep${l.length === 1 ? 's' : ''} slipping`;
}

function renderHome() {
  rollDay();
  renderFrieze();
  const c = counts(null);
  const revRoom = Math.max(0, state.settings.maxRev - state.revDone);
  const newRoom = Math.max(0, newBudget() - state.newDone);
  const dueNow = Math.min(c.due, revRoom) + c.learning;
  const newNow = Math.min(c.fresh, newRoom);

  $('#home-sub').textContent = `${DECK.cards.length} cards · ${DECK.sections.length} sections`;

  // On day one every one of these reads as zero or nonsense — "0 to review" and
  // "0% started" tell a first-time reader nothing except that they have failed
  // at something. They appear once there is something to count.
  $('#today-counts').hidden = c.seen === 0;
  $('#today-counts').innerHTML = `
    <div class="due"><b>${dueNow}</b><span>to review</span></div>
    <div><b>${newNow}</b><span>new today</span></div>
    <div><b>${Math.round((c.seen / DECK.cards.length) * 100)}%</b><span>of the deck started</span></div>`;

  const btn = $('#study-all');
  const totalNow = dueNow + newNow;
  if (totalNow > 0) {
    btn.textContent = `Study ${totalNow} card${totalNow === 1 ? '' : 's'}`;
    btn.dataset.mode = 'normal';
    // Say the finishing date, not the rate. "20 a day" makes the reader do the
    // division; most will not, and will find out too late that it does not fit.
    const pace = newBudget();
    $('#today-note').textContent = !c.fresh
      ? 'You have seen every card at least once. From here it is all repeats.'
      : pace > 0
        ? `At ${pace} new cards a day you will have seen all ${DECK.cards.length} in ${daysToSeeAll(c.fresh)} days.`
        : `New cards are switched off, so ${c.fresh} of ${DECK.cards.length} will stay unseen. Raise the daily number in Progress.`;
  } else {
    const batch = Math.min(AHEAD_BATCH, c.fresh || AHEAD_BATCH);
    btn.textContent = c.fresh ? `Do ${batch} more now` : 'Study ahead';
    btn.dataset.mode = 'ahead';
    $('#today-note').textContent = c.fresh
      ? `Today's ${newBudget()} are done and nothing is due. You can do ${batch} more now. ${c.fresh} cards left to see.`
      : 'Nothing is due. Studying ahead pulls forward the cards scheduled soonest — worth it the week before the exam, not before.';
  }

  const today = countStudiedToday();
  $('#today-done').hidden = today === 0;
  $('#today-done').textContent = `You have answered ${today} card${today === 1 ? '' : 's'} today.`;

  renderAskExam(c);
  renderExamBanner(c);
  renderLeechRow();

  const list = $('#section-list');
  list.innerHTML = '';
  for (const s of DECK.sections) {
    const sc = counts(s.k);
    const pending = Math.min(sc.due, 999) + sc.learning;
    const pct = Math.round(((sc.mature + (sc.seen - sc.learning - sc.mature) * 0.5) / s.n) * 100);
    // The meta line says what the number means. A bare badge on an untouched
    // section reads as "12 due" when it means "12 you have never seen".
    let meta;
    if (pending) meta = `${pending} to review · ${s.n} cards`;
    else if (sc.seen === 0) meta = `${s.n} cards · not started`;
    else if (sc.fresh) meta = `${sc.fresh} new left · ${s.n} cards`;
    else meta = `all ${s.n} scheduled · ${pct}% known well`;

    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = `
      ${doodle(SECTION_ART[s.k] || 'boat', 'sect-art')}
      <span class="sect-name">${escapeHtml(s.t)}</span>
      ${pending ? `<span class="sect-badge">${pending}</span>` : ''}
      <span class="sect-meta">${meta}</span>
      ${pct > 0 ? `<span class="sect-meter"><i style="width:${Math.min(100, pct)}%"></i></span>` : ''}`;
    b.setAttribute('aria-label', `${s.t}. ${meta}. Study this section.`);
    b.addEventListener('click', () => startSession(s.k));
    li.appendChild(b);
    list.appendChild(li);
  }
}

/* ── study ── */

function startSession(sectionKey, opts) {
  rollDay();
  session = buildSession(sectionKey, opts);
  undoStack = [];
  let extra = false;
  if (!session.queue.length) {
    // A section with nothing due: offer its unseen cards anyway, but say so —
    // otherwise the home screen reads "0 new today" and tapping a section
    // silently hands over twenty more, which looks like one of them is lying.
    const c = counts(sectionKey);
    session = buildSession(sectionKey, c.fresh > 0 ? { allNew: true } : { ahead: true });
    extra = session.queue.length > 0;
  }
  if (!session.queue.length) {
    toast('Nothing to study in that section yet.');
    return;
  }
  if (extra) toast('These are extra cards, on top of today’s plan.');
  go('study');
  // "Keep going" from the summary starts a new session inside the same visit;
  // pushing a second stop would make leaving take two Back presses.
  if (stops[stops.length - 1] !== 'study') pushStop('study');
  showCard();
}

function leaveStudy(fromHistory) {
  $$('#done-reel video, #card-video video').forEach((v) => v.pause());
  session = null;
  if (current !== 'home') go('home');
  if (!fromHistory && stops[stops.length - 1] === 'study') history.back();
}

function currentCard() {
  return session && session.queue.length ? byId.get(session.queue[0]) : null;
}

function showCard() {
  const card = currentCard();
  if (!card) return finish();
  session.revealed = false;

  const sect = sectionOf.get(card.s);
  $('#study-section').textContent = sect ? sect.t : card.s;
  $('#study-left').textContent = `${session.done} done · ${session.queue.length} left`;
  const pct = session.total ? Math.round((session.done / (session.done + session.queue.length)) * 100) : 0;
  $('#session-bar').style.width = pct + '%';
  $('#session-bar-wrap').setAttribute('aria-valuenow', String(pct));

  // Only "new" earns a badge. "Young" versus "mature" is the scheduler's
  // business and reads as a difficulty rating the author set.
  const fresh = stateOf(card.i) === 'new';
  $('#card-chip').hidden = !fresh;
  $('#card-chip').textContent = 'new';
  const rec = state.recs[card.i];
  $('#leech-chip').hidden = !(rec && rec.lp >= LEECH_AT);

  // Card HTML is generated by src/web_build.py, which allows only b/i/u/br/sub/sup.
  $('#card-q').innerHTML = card.q;
  $('#card-a').innerHTML = card.a;

  renderCardFigure(card);

  const fig = $('#card-fig');
  if (card.m) {
    const img = $('#card-img');
    img.width = card.d[0];
    img.height = card.d[1];
    img.alt = `Diagram: ${stripTags(card.q)}`;
    // Offline with an uncached diagram, this used to be a broken-image icon
    // under a caption inviting you to tap it, and the lightbox opened empty.
    img.onerror = () => {
      fig.hidden = true;
      $('#fig-missing').hidden = false;
    };
    img.onload = () => { $('#fig-missing').hidden = true; };
    img.src = 'img/' + card.m;
    $('#fig-btn').setAttribute('aria-label', `Enlarge the diagram: ${stripTags(card.q)}`);
    fig.hidden = false;
    $('#fig-missing').hidden = true;
  } else {
    fig.hidden = true;
    $('#fig-missing').hidden = true;
    $('#card-img').removeAttribute('src');
  }

  $('#answer-wrap').hidden = true;
  // A player left running would keep talking over the next question.
  $$('#card-video video').forEach((v) => v.pause());
  $('#card-video').hidden = true;
  $('#card-video').innerHTML = '';
  $('#reveal-btn').hidden = false;
  $('#grade-row').hidden = true;
  $('#grade-ask').hidden = true;
  $('#card-scroll').classList.remove('shown');
  $('#undo-btn').disabled = undoStack.length === 0;
  $('#card-scroll').scrollTop = 0;
  // Deal the new card in. Same element every time, so the animation only
  // replays if the class is dropped and the layout is flushed in between.
  const qa = $('.qa');
  qa.classList.remove('in');
  void qa.offsetWidth;
  qa.classList.add('in');
  $('#reveal-btn').focus({ preventScroll: true });
}

function reveal() {
  if (!session || session.revealed) return;
  const card = currentCard();
  if (!card) return;
  session.revealed = true;
  $('#answer-wrap').hidden = false;
  $('#reveal-btn').hidden = true;
  $('#grade-row').hidden = false;
  $('#grade-ask').hidden = false;
  $('#card-scroll').classList.add('shown');
  renderCardVideo(card);
  // The reveal button was the focused element and has just been hidden, which
  // drops focus to <body>. Put it on the answer so it is read out and so Tab
  // continues from the right place.
  $('#card-a').focus({ preventScroll: true });
  const rec = state.recs[card.i];
  for (let g = 1; g <= 4; g++) {
    const d = preview(rec, g);
    // "(max)" explains why two buttons can show the same number: the exam date
    // is holding both down, not a bug.
    const capped = d > 0 && d === ceiling() && daysToExam() !== null;
    const label = d === 0 ? 'soon' : fmtDays(d) + (capped ? ' max' : '');
    $('#iv' + g).textContent = label;
    const btn = $(`.grade[data-g="${g}"]`);
    btn.setAttribute('aria-label',
      `${['', 'Again', 'Hard', 'Good', 'Easy'][g]} — see it again ${d === 0 ? 'later in this session' : 'in ' + label}`);
  }
}

function answer(g) {
  if (!session || !session.revealed) return;
  const id = session.queue[0];
  if (!id) return;
  undoStack.push({
    snap: JSON.stringify(state),
    queue: session.queue.slice(),
    s: {
      done: session.done, again: session.again, good: session.good,
      clean: session.clean, maxClean: session.maxClean,
    },
  });
  if (undoStack.length > 25) undoStack.shift();

  // Again and Hard are the app's own evidence of what you have not learned —
  // exactly the cards worth two minutes of video at the end.
  if (g <= 2) {
    for (const c of VIDEOS.cards[id] || []) {
      if (!session.reel.includes(c)) session.reel.push(c);
    }
  }
  const outcome = grade(id, g);
  // A clean run is consecutive cards without an Again, inside one session.
  if (g === 1) { session.again++; session.clean = 0; } else {
    session.good++;
    session.clean = n(session.clean) + 1;
    session.maxClean = Math.max(n(session.maxClean), session.clean);
  }

  session.queue.shift();
  if (outcome === 'stay') {
    const gap = g === 1 ? 4 : 8;
    const at = Math.min(session.queue.length, gap);
    session.queue.splice(at, 0, id);
  } else {
    session.done++;
  }
  const sess = session;
  showCard();
  // After the next card is on screen, so the unlock lands on top of the new
  // question rather than the one just answered.
  checkAchievements(sess);
}

function undo() {
  const u = undoStack.pop();
  if (!u) return;
  state = JSON.parse(u.snap);
  session.queue = u.queue;
  Object.assign(session, u.s);
  save();
  showCard();
  toast('Undone');
}

function finish() {
  const acc = session.again + session.good
    ? Math.round((session.good / (session.again + session.good)) * 100) : 0;
  $('#done-stats').innerHTML = `
    <div><b>${session.done}</b><span>cards</span></div>
    <div><b>${acc}%</b><span>first try</span></div>
    <div><b>${session.startedNew}</b><span>new</span></div>
    <div><b>${n(state.streak)}</b><span>day streak</span></div>`;

  const c = counts(null);
  const revRoom = Math.max(0, state.settings.maxRev - state.revDone);
  const newRoom = Math.max(0, newBudget() - state.newDone);
  const left = Math.min(c.due, revRoom) + c.learning + Math.min(c.fresh, newRoom);

  $('#done-title').textContent = session.section
    ? (sectionOf.get(session.section) || {}).t || 'Section done'
    : 'Session finished';
  $('#done-line').textContent = left > 0
    ? `${left} more card${left === 1 ? '' : 's'} are ready across the deck.`
    : nextDueLine();
  $('#done-more').hidden = left === 0;

  // A boat under sail with four pen-strokes flying off it, instead of a tick.
  const badge = (session.section && SECTION_ART[session.section]) || 'boat';
  $('#done-tick').innerHTML = doodle(badge)
    + [[-30, -20], [30, -20], [-22, 18], [22, 18]]
      .map(([dx, dy], i) => `<i class="spark" style="--dx:${dx}px;--dy:${dy}px;animation-delay:${(i * 0.07).toFixed(2)}s"></i>`)
      .join('');

  renderReel(session.reel.slice(0, 5));
  checkAchievements(session);
  session = null;
  go('done');
  $('#done-home').focus({ preventScroll: true });
}

/* The reel is built from the cards you graded Again or Hard in the session
 * just finished — the material you have just proved you do not know. */
function reelClips() {
  return (lastReel || []).map((c) => VIDEOS.clips[c]).filter(Boolean);
}
let lastReel = [];

function renderReel(ids) {
  lastReel = ids;
  const wrap = $('#done-reel');
  const clips = reelClips();
  wrap.hidden = !clips.length;
  if (!clips.length) return;
  const secs = clips.reduce((t, c) => t + n(c.d), 0);
  $('#reel-h').textContent = clips.length === 1
    ? `A clip on one you found hard — ${fmtClock(secs)}`
    : `${clips.length} clips on the ones you found hard — ${fmtClock(secs)}`;
  $('#reel-strip').innerHTML = `<div class="vrow">${clips.map((c) => thumbHtml(c)).join('')}</div>`;
}

function nextDueLine() {
  const now = Date.now();
  let soonest = Infinity;
  for (const c of DECK.cards) {
    const r = state.recs[c.i];
    if (r && r.st === 'r' && r.due > now) soonest = Math.min(soonest, r.due);
  }
  if (soonest === Infinity) return 'Nothing else is scheduled. You can start new cards whenever you like.';
  const days = Math.max(0, Math.round((startOfDay(soonest) - startOfDay(now)) / DAY));
  if (days <= 0) return 'More cards come back later today.';
  return days === 1
    ? 'Nothing is due until tomorrow. You can start new cards now if you want to.'
    : `Nothing is due for ${days} days. You can start new cards now if you want to.`;
}

function fmtDays(d) {
  if (d < 1) return 'today';
  if (d === 1) return '1 day';
  if (d < 30) return d + ' days';
  const m = d / 30;
  if (d < 365) return (m < 2 ? '1 month' : Math.round(m) + ' months');
  const y = d / 365;
  return y < 2 ? '1 year' : Math.round(y) + ' years';
}

/* ── browse ── */

let browseLimit = 40;
const LEECH_FILTER = '★leech';

function renderBrowse() {
  const sel = $('#sect-filter');
  const lc = leeches().length;
  // Rebuilt only when the leech count changes, so the open dropdown does not
  // reset itself while you are choosing from it.
  if (sel.dataset.leeches !== String(lc)) {
    sel.dataset.leeches = String(lc);
    const keep = sel.value;
    sel.innerHTML = '<option value="">All sections</option>' +
      (lc ? `<option value="${LEECH_FILTER}">★ Keeps slipping (${n(lc)})</option>` : '') +
      DECK.sections.map((s) => `<option value="${escapeHtml(s.k)}">${escapeHtml(s.t)}</option>`).join('');
    sel.value = keep;
  }
  const q = $('#search').value.trim().toLowerCase();
  const sk = sel.value;
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = DECK.cards.filter((c) => {
    if (sk === LEECH_FILTER) {
      const r = state.recs[c.i];
      if (!r || r.lp < LEECH_AT) return false;
    } else if (sk && c.s !== sk) return false;
    if (!terms.length) return true;
    const hay = (c.q + ' ' + c.a).toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  const filtered = !!(sk || terms.length);
  $('#browse-count').textContent = filtered
    ? `${hits.length} of ${DECK.cards.length} cards`
    : `${hits.length} cards`;
  $('#browse-clear').hidden = !filtered;

  const list = $('#browse-list');
  list.innerHTML = '';
  if (!hits.length) {
    const bits = [];
    if (terms.length) bits.push(`nothing matches “${q}”`);
    if (sk === LEECH_FILTER) bits.push('no cards are slipping yet');
    else if (sk) bits.push(`in ${(sectionOf.get(sk) || {}).t || sk}`);
    list.innerHTML = `<li class="empty">${escapeHtml(bits.join(' ') || 'No cards')}. Try fewer words, or clear the filter.</li>`;
    $('#browse-more').hidden = true;
    return;
  }
  for (const c of hits.slice(0, browseLimit)) {
    const li = document.createElement('li');
    const sect = sectionOf.get(c.s);
    const hasFig = !c.m && c.f && FIGURES && FIGURES[c.f.n];
    li.innerHTML = `<details><summary></summary><div class="browse-ans">${c.a}
      ${c.m ? `<img src="img/${encodeURIComponent(c.m)}" alt="Diagram: ${escapeHtml(stripTags(c.q))}" loading="lazy" width="${n(c.d[0])}" height="${n(c.d[1])}"><span class="b-zoom">Tap the diagram to enlarge</span>` : ''}
      ${hasFig ? `<span class="b-fig">${figureSVG(c)}</span><span class="b-zoom">Tap the drawing to enlarge</span>` : ''}
      <span class="b-sect">${escapeHtml(sect ? sect.t : c.s)} · ${STATE_WORDS[stateOf(c.i)]}</span></div></details>`;
    li.querySelector('summary').innerHTML = c.q;
    if (c.m) {
      li.querySelector('img').addEventListener('click', () => openLightbox(c));
    }
    if (hasFig) {
      const holder = li.querySelector('.b-fig');
      litFigure(holder, c);
      holder.addEventListener('click', () => openLightbox(c));
    }
    list.appendChild(li);
  }
  $('#browse-more').hidden = hits.length <= browseLimit;
  $('#browse-more').textContent = `Show more (${hits.length - browseLimit} left)`;
}

/* ── stats ── */

/** Say what a backup would actually contain, so "export" is not a leap of faith. */
function renderBackupState() {
  const el = $('#backup-state');
  if (!el) return;
  const withHistory = Object.keys(state.recs).length;
  el.textContent = withHistory
    ? `A backup right now would hold ${withHistory} of ${DECK.cards.length} cards, `
      + `${state.streak} day${state.streak === 1 ? '' : 's'} of streak and your settings.`
    : 'Nothing to back up yet — study some cards first.';
}

function renderStats() {
  rollDay();
  const buckets = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const c of DECK.cards) buckets[stateOf(c.i)]++;
  const acc = state.revTotal ? Math.round((state.revGood / state.revTotal) * 100) : null;

  $('#stats-sub').textContent = `${countStudiedToday()} answers today`;
  $('#stat-tiles').innerHTML = `
    <div class="tile"><b>${n(state.streak)}</b><span>day streak</span></div>
    <div class="tile"><b>${buckets.mature}</b><span>solid <small>— still there in three weeks</small></span></div>
    <div class="tile"><b>${buckets.young + buckets.learning}</b><span>seen, not solid yet</span></div>
    <div class="tile"><b>${buckets.new}</b><span>not started</span></div>
    <div class="tile"><b>${acc === null ? 'n/a' : acc + '%'}</b><span>${acc === null
        ? 'repeat cards right — not enough data yet' : 'of repeat cards you got right'}</span></div>
    <div class="tile"><b>${n(state.revTotal)}</b><span>repeat cards answered</span></div>`;

  // forecast
  const now = Date.now();
  const bins = new Array(7).fill(0);
  for (const c of DECK.cards) {
    const r = state.recs[c.i];
    if (!r || r.st !== 'r') continue;
    const d = Math.round((startOfDay(r.due) - startOfDay(now)) / DAY);
    if (d <= 0) bins[0]++;
    else if (d < 7) bins[d]++;
  }
  const peak = Math.max(1, ...bins);
  const names = ['Today', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 1; i < 7; i++) {
    names[i] = new Date(now + i * DAY).toLocaleDateString(undefined, { weekday: 'short' });
  }
  $('#forecast').innerHTML = bins.map((n, i) => `
    <div class="fc-col">
      <span class="fc-n">${n || ''}</span>
      <span class="fc-bar ${n ? '' : 'empty'}" style="height:${n ? Math.max(6, (n / peak) * 68) : 3}px"></span>
      <span class="fc-d">${names[i]}</span>
    </div>`).join('');
  $('#forecast').setAttribute('aria-label',
    'Cards due: ' + bins.map((n, i) => `${names[i]} ${n}`).join(', '));

  $('#mastery').innerHTML = DECK.sections.map((s) => {
    const b = { new: 0, learning: 0, young: 0, mature: 0 };
    for (const c of DECK.cards) if (c.s === s.k) b[stateOf(c.i)]++;
    const p = (x) => (x / s.n) * 100;
    return `<li>
      <span>${escapeHtml(s.t)}</span>
      <span class="m-n">${b.mature} solid · ${b.young + b.learning} seen · ${s.n} total</span>
      <span class="m-bar" role="img" aria-label="${b.mature} known well, ${b.young} bedding in, ${b.learning} learning, ${b.new} not started">
        <i class="m-mature" style="width:${p(b.mature)}%"></i>
        <i class="m-young" style="width:${p(b.young)}%"></i>
        <i class="m-learn" style="width:${p(b.learning)}%"></i>
      </span></li>`;
  }).join('');

  $('#set-new').value = state.settings.newPerDay;
  $('#set-max').value = state.settings.maxRev;
  $('#set-shuffle').checked = state.settings.shuffle;
  $('#set-exam').value = state.settings.examDate || '';
  const d = daysToExam();
  $('#exam-hint').textContent = d === null
    ? 'Add your exam date and the app works out how many new cards a day you need to see all 537 in time.'
    : d < 0 ? 'That date has passed. Clear it to go back to normal spacing.'
      : `${longDate(state.settings.examDate)}. No card will be left longer than ${fmtDays(ceiling())} between reviews.`;
  const auto = newBudget();
  $('#new-hint').textContent = auto > state.settings.newPerDay
    ? `Raised to ${auto} a day to get through the deck before your exam.`
    : '';
  $('#build-line').textContent = `Deck build ${DECK.build} · ${DECK.cards.length} cards`;
  renderAch();
  renderBackupState();
}

/* ─────────────────────────── lightbox ─────────────────────────── */

const lb = { scale: 1, tx: 0, ty: 0, base: null, pointers: new Map(), lastTap: 0, pinch: null, opener: null, node: null };

function openLightbox(card) {
  const img = $('#lb-img');
  const figBox = $('#lb-fig');
  const isFig = !card.m && card.f && FIGURES && FIGURES[card.f.n];
  lb.opener = document.activeElement;
  img.hidden = !!isFig;
  figBox.hidden = !isFig;
  lb.node = isFig ? figBox : img;
  $('#lb-stage').dataset.kind = isFig ? 'fig' : 'img';
  if (isFig) {
    img.removeAttribute('src');
    figBox.innerHTML = figureSVG(card);
    litFigure(figBox, card);
  } else {
    figBox.innerHTML = '';
    img.src = 'img/' + card.m;
    img.alt = `Diagram: ${stripTags(card.q)}`;
  }
  $('#lb-title').textContent = stripTags(card.q).slice(0, 90);
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  // aria-modal alone does not stop Tab walking into the page behind the
  // overlay; inert does, and it is what the attribute is claiming.
  // The skip link is a sibling of #app, so inerting #app alone leaves it
  // tabbable behind the overlay — and activating it fires a fragment
  // navigation, which pops a history entry the app was relying on.
  setBackgroundInert(true);
  const fit = () => {
    lb.base = lb.node.getBoundingClientRect();
    const stage = $('#lb-stage').getBoundingClientRect();
    lb.base = { x: lb.base.x - stage.x, y: lb.base.y - stage.y, w: lb.base.width, h: lb.base.height };
    // These diagrams are dense line art. Fitting one into a phone screen makes the
    // labels unreadable, so open at a scale that gives the drawing room to be read
    // and let the reader pan, rather than opening at a useless "fits perfectly".
    // A figure is drawn to be read at card size, so it opens to fit and zooms
    // from there; a diagram is a dense reference page and opens already big.
    const natural = isFig
      ? Number(FIGURES[card.f.n].vb.split(/\s+/)[2]) || lb.base.w
      : img.naturalWidth / 2;
    const wanted = isFig ? lb.base.w : Math.min(1000, natural);
    lb.scale = clamp(wanted / Math.max(1, lb.base.w), 1, 4);
    // Open at the top-left corner, not the middle: every diagram puts its title
    // and first panel there, so that is where reading starts.
    lb.tx = -lb.base.x;
    lb.ty = -lb.base.y;
    clampPan();
    apply();
  };
  if (isFig || img.complete) requestAnimationFrame(fit);
  else img.onload = () => requestAnimationFrame(fit);
  $('#lb-close').focus({ preventScroll: true });
  pushStop('lightbox');
}

function closeLightbox(fromHistory) {
  if ($('#lightbox').hidden) return;
  $('#lightbox').hidden = true;
  document.body.style.overflow = '';
  setBackgroundInert(false);
  $('#lb-img').removeAttribute('src');
  $('#lb-fig').innerHTML = '';
  lb.node = null;
  if (lb.opener && lb.opener.focus) lb.opener.focus({ preventScroll: true });
  if (!fromHistory && stops[stops.length - 1] === 'lightbox') history.back();
}

/* The phone's Back gesture is the most-used control on Android and it must not
 * throw you out of the app just because a diagram is open. Each modal-ish state
 * pushes a history entry; popstate unwinds exactly one level. Closing from
 * inside the app calls history.back() and lets the same handler do the work,
 * so there is one code path however you leave. */
const stops = [];
function pushStop(name) {
  stops.push(name);
  history.pushState({ stop: name }, '');
}
addEventListener('popstate', () => {
  const top = stops.pop();
  if (top === 'lightbox') return closeLightbox(true);
  if (top === 'study') return leaveStudy(true);
  // No stop recorded. A reload leaves the pushed history entries behind while
  // `stops` starts empty, and a fragment link fires popstate of its own. Unwind
  // whatever is actually open rather than doing nothing, which reads as a Back
  // press that the app swallowed.
  if (!$('#lightbox').hidden) return closeLightbox(true);
  if (current === 'study' || current === 'done') return leaveStudy(true);
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setBackgroundInert(on) {
  $('#app').inert = on;
  const skip = document.querySelector('.skip');
  if (skip) skip.inert = on;
}

function apply() {
  if (lb.node) lb.node.style.transform = `translate(${lb.tx}px,${lb.ty}px) scale(${lb.scale})`;
  // The hint has to follow the zoom, or it tells you to double-tap to fit while
  // you are already looking at the whole diagram.
  const zoomed = lb.scale > 1.05;
  $('#lb-hint').textContent = zoomed
    ? 'Drag to pan · double-tap to fit the whole diagram · pinch to zoom'
    : 'Double-tap or pinch to zoom in · drag to pan';
  $('#lb-title').dataset.zoom = zoomed ? 'in' : 'fit';
}

function clampPan() {
  if (!lb.base) return;
  const st = $('#lb-stage').getBoundingClientRect();
  const w = lb.base.w * lb.scale, h = lb.base.h * lb.scale;
  if (w <= st.width) lb.tx = (st.width - w) / 2 - lb.base.x;
  else lb.tx = clamp(lb.tx, st.width - (lb.base.x + w), -lb.base.x);
  if (h <= st.height) lb.ty = (st.height - h) / 2 - lb.base.y;
  else lb.ty = clamp(lb.ty, st.height - (lb.base.y + h), -lb.base.y);
}

function zoomAt(cx, cy, next) {
  const st = $('#lb-stage').getBoundingClientRect();
  const px = cx - st.x, py = cy - st.y;
  const k = next / lb.scale;
  lb.tx = px - k * (px - lb.tx);
  lb.ty = py - k * (py - lb.ty);
  lb.scale = next;
  clampPan();
  apply();
}

function initLightbox() {
  const stage = $('#lb-stage');

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lb.pointers.size === 2) {
      const [a, b] = Array.from(lb.pointers.values());
      lb.pinch = { d: dist(a, b), s: lb.scale };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = lb.pointers.get(e.pointerId);
    if (!p) return;
    const prev = { x: p.x, y: p.y };
    p.x = e.clientX; p.y = e.clientY;
    if (lb.pointers.size === 2 && lb.pinch) {
      const [a, b] = Array.from(lb.pointers.values());
      const d = dist(a, b);
      const next = clamp(lb.pinch.s * (d / lb.pinch.d), 1, 6);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, next);
    } else if (lb.pointers.size === 1) {
      lb.tx += e.clientX - prev.x;
      lb.ty += e.clientY - prev.y;
      clampPan();
      apply();
    }
  });

  const up = (e) => {
    lb.pointers.delete(e.pointerId);
    if (lb.pointers.size < 2) lb.pinch = null;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  stage.addEventListener('click', (e) => {
    const now = Date.now();
    if (now - lb.lastTap < 320) {
      const next = lb.scale > 1.2 ? 1 : 2.6;
      zoomAt(e.clientX, e.clientY, next);
      lb.lastTap = 0;
    } else {
      lb.lastTap = now;
    }
  });

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, clamp(lb.scale * (e.deltaY < 0 ? 1.15 : 0.87), 1, 6));
  }, { passive: false });

  $('#lb-close').addEventListener('click', () => closeLightbox());
  // A visible control at the top, where the eye starts. The hint at the bottom
  // of the screen was read too late: a diagram that opens zoomed and cropped
  // looks broken until you know it is deliberate.
  $('#lb-fit').addEventListener('click', () => {
    const st = $('#lb-stage').getBoundingClientRect();
    zoomAt(st.x + st.width / 2, st.y + st.height / 2, lb.scale > 1.05 ? 1 : 2.6);
    $('#lb-fit').setAttribute('aria-label',
      lb.scale > 1.05 ? 'Fit the whole diagram on screen' : 'Zoom in');
  });
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ─────────────────────────── misc ─────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* Card text for places that take plain text — image alt, the lightbox title.
 * The browser owns the entity table: a hand-rolled list of five replacements
 * left "145&deg;T" being read out to screen-reader users as written. */
const decoder = document.createElement('textarea');
function stripTags(s) {
  decoder.innerHTML = String(s).replace(/<[^>]*>/g, '');
  return decoder.value;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('away');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('away'); }, 3400);
}

/** Is this a date a person could have meant, or a year still being typed? */
function plausibleExam(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const y = Number(v.slice(0, 4));
  return y >= EXAM_MIN_YEAR && y <= EXAM_MAX_YEAR;
}

/* The same window, told to the native picker, so its own arrows and its
 * validation agree with what the app will accept. */
function boundExamInputs() {
  for (const el of [$('#home-exam'), $('#set-exam')]) {
    el.min = EXAM_MIN_YEAR + '-01-01';
    el.max = EXAM_MAX_YEAR + '-12-31';
  }
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#theme-glyph').textContent = t === 'auto' ? '◐' : t === 'dark' ? '☾' : '☀';
  $('#theme-btn').title = `Colour theme: ${t}`;
  const dark = t === 'dark'
    || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-color').setAttribute('content', dark ? '#141519' : '#f0eee7');
}

/* ─────────────────────────── wiring ─────────────────────────── */

function wire() {
  $$('#nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  $('#study-all').addEventListener('click', (e) => {
    startSession(null, e.currentTarget.dataset.mode === 'ahead' ? { ahead: true } : {});
  });
  $('#reveal-btn').addEventListener('click', reveal);
  // Tapping the card itself is the gesture people expect from every other
  // flashcard app. Ignore it if they were selecting text to copy.
  $('#card-scroll').addEventListener('click', (e) => {
    if (session && session.revealed) return;
    if (e.target.closest('button, a')) return;
    const sel = getSelection();
    if (sel && String(sel).length > 2) return;
    reveal();
  });
  $$('.grade').forEach((b) => b.addEventListener('click', () => answer(+b.dataset.g)));
  $('#undo-btn').addEventListener('click', undo);
  $('#study-back').addEventListener('click', () => leaveStudy(false));
  $('#end-btn').addEventListener('click', () => leaveStudy(false));
  $('#fig-btn').addEventListener('click', () => {
    const c = currentCard();
    if (c && c.m) openLightbox(c);
  });
  $('#figure-plate').addEventListener('click', () => {
    const c = currentCard();
    if (c && c.f) openLightbox(c);
  });
  boundExamInputs();
  wireVideo('#card-video');
  wireVideo('#done-reel');
  $('#unlock').addEventListener('click', dismissUnlock);
  $('#done-home').addEventListener('click', () => leaveStudy(false));
  $('#done-more').addEventListener('click', () => startSession(null, {}));

  $('#theme-btn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % 3];
    applyTheme();
    save();
  });

  let searchTimer = null;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { browseLimit = 40; renderBrowse(); }, 140);
  });
  $('#sect-filter').addEventListener('change', () => { browseLimit = 40; renderBrowse(); });
  $('#browse-clear').addEventListener('click', () => {
    $('#search').value = '';
    $('#sect-filter').value = '';
    browseLimit = 40;
    renderBrowse();
    $('#search').focus();
  });
  $('#browse-more').addEventListener('click', () => { browseLimit += 60; renderBrowse(); });

  $('#set-new').addEventListener('change', (e) => {
    state.settings.newPerDay = clamp(parseInt(e.target.value, 10) || 0, 0, 200);
    e.target.value = state.settings.newPerDay;
    save();
  });
  $('#set-max').addEventListener('change', (e) => {
    state.settings.maxRev = clamp(parseInt(e.target.value, 10) || 10, 10, 999);
    e.target.value = state.settings.maxRev;
    save();
  });
  $('#set-shuffle').addEventListener('change', (e) => {
    state.settings.shuffle = e.target.checked;
    save();
  });
  const setExamDate = (value) => {
    // Half-typed years arrive here as 0002-08-12. Ignore them: the change event
    // fires again with the real year a keystroke later.
    if (value && !plausibleExam(value)) return false;
    state.settings.examDate = value || '';
    if (value) state.settings.examSkipped = false;
    // Existing cards may already be scheduled past the new date; pull them in.
    // Only for a date in the future: a typo like 2025 instead of 2026 would
    // otherwise rewrite every card to a one-day interval, and clearing the date
    // afterwards cannot undo it.
    const cap = ceiling();
    const d = daysToExam();
    let moved = 0;
    if (d !== null && d >= 0) {
      for (const r of Object.values(state.recs)) {
        if (r.st === 'r' && r.ivl > cap) {
          r.ivl = cap;
          r.due = Math.min(r.due, startOfDay(Date.now() + cap * DAY));
          moved++;
        }
      }
    }
    writeNow();
    $('#set-exam').value = state.settings.examDate;
    $('#home-exam').value = state.settings.examDate;
    $('#home-exam-parsed').textContent = value ? longDate(value) : '';
    if (current === 'stats') renderStats(); else renderHome();
    if (moved) toast(`${moved} cards moved earlier so you see them before your exam.`);
    return true;
  };
  $('#set-exam').addEventListener('change', (e) => setExamDate(e.target.value));
  $('#home-exam').addEventListener('change', (e) => {
    if (setExamDate(e.target.value) && e.target.value) {
      toast('Set. The daily number now fits your date.');
    }
  });
  // Leaving the field with a half-typed year in it would show a date the app is
  // not using. Put the stored one back.
  for (const el of [$('#home-exam'), $('#set-exam')]) {
    el.addEventListener('blur', () => {
      if (el.value && !plausibleExam(el.value)) el.value = state.settings.examDate || '';
    });
  }
  $('#skip-exam').addEventListener('click', () => {
    state.settings.examSkipped = true;
    save();
    renderHome();
    toast('You can add a date later in Progress.');
  });
  $('#leech-row').addEventListener('click', () => {
    go('browse');
    $('#search').value = '';
    $('#sect-filter').value = LEECH_FILTER;
    browseLimit = 40;
    renderBrowse();
  });

  $('#export-btn').addEventListener('click', () => {
    writeNow();
    // The file is stamped so restore can tell a real backup from any other
    // JSON, and so a human opening it can see what it is and how old it is.
    const payload = Object.assign({
      app: EXPORT_APP,
      format: EXPORT_FORMAT,
      exportedAt: new Date(Date.now()).toISOString(),
      deckBuild: DECK.build,
      cardsWithHistory: Object.keys(state.recs).length,
    }, state);
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `day-skipper-progress-${state.day}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Exported ${payload.cardsWithHistory} cards of history.`);
    renderBackupState();
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';                       // so re-picking the same file fires again
    if (!f) return;
    let s;
    try {
      s = JSON.parse(await f.text());
    } catch (err) {
      toast('That file is not readable as JSON.');
      return;
    }
    if (!isPlainObject(s) || !isPlainObject(s.recs)) {
      toast('That is not a Day Skipper backup — it has no review history in it.');
      return;
    }
    if (s.app && s.app !== EXPORT_APP) {
      toast(`That backup is from ${String(s.app).slice(0, 30)}, not this deck.`);
      return;
    }

    const incoming = sanitise(s);
    const ids = Object.keys(incoming.recs);
    const known = ids.filter((id) => byId.has(id));
    if (!known.length) {
      toast('None of the cards in that file are in this deck. Nothing restored.');
      return;
    }

    const mine = Object.keys(state.recs).length;
    const when = s.exportedAt ? ` from ${longDate(String(s.exportedAt).slice(0, 10))}` : '';
    const lost = ids.length - known.length;
    const warn = mine
      ? `\n\nThis replaces the ${mine} cards of history already on this device.`
      : '';
    if (!confirm(`Restore ${known.length} cards of history${when}?${warn}`)) return;

    state = incoming;
    // Drop history for cards that are no longer in the deck here rather than at
    // the next boot, so the number in the message is the truth.
    for (const id of ids) if (!byId.has(id)) delete state.recs[id];
    rollDay();
    writeNow();
    applyTheme();
    renderStats();
    toast(lost
      ? `Restored ${known.length} cards. ${lost} were from an older deck and were dropped.`
      : `Restored ${known.length} cards of history.`);
  });

  $('#prefetch-btn').addEventListener('click', async () => {
    const btn = $('#prefetch-btn');
    if (!('serviceWorker' in navigator)) {
      toast('This browser cannot store the diagrams offline.');
      return;
    }
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg || !reg.active) {
      toast('Offline storage is still starting up — try again in a moment.');
      return;
    }
    const urls = Array.from(new Set(DECK.cards.filter((c) => c.m).map((c) => 'img/' + c.m)));
    btn.disabled = true;
    btn.textContent = `Saving 0 of ${urls.length}…`;
    reg.active.postMessage({ type: 'prefetch', urls });
  });
  // Registered once, not inside the click handler — a listener added per click
  // stacks up and every future completion fires all of them.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || (d.type !== 'prefetching' && d.type !== 'prefetched')) return;
      const btn = $('#prefetch-btn');
      if (d.type === 'prefetching') {
        btn.textContent = `Saving ${d.done} of ${d.total}…`;
        return;
      }
      btn.disabled = false;
      btn.textContent = d.failed
        ? `${d.total - d.failed} of ${d.total} saved — retry the rest`
        : 'All diagrams saved offline ✓';
    });
  }

  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Erase all review history on this device? Export a backup first if you might want it back.')) return;
    state = freshState();
    writeNow();
    applyTheme();
    renderStats();
    toast('Progress erased.');
  });

  addEventListener('keydown', (e) => {
    if (!$('#lightbox').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      if (e.key === '+' || e.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, clamp(lb.scale * 1.25, 1, 6));
      if (e.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, clamp(lb.scale / 1.25, 1, 6));
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || ''));
    if (typing) return;
    if (current !== 'study') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!session.revealed) reveal();
      else answer(3);
    } else if (e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      if (session.revealed) answer(+e.key);
      else reveal();
    } else if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      leaveStudy(false);
    }
  });

  initLightbox();
}

/* ─────────────────────────── boot ─────────────────────────── */

async function boot() {
  load();
  applyTheme();
  try {
    const res = await fetch('cards.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DECK = await res.json();
  } catch (e) {
    $('#boot').innerHTML =
      '<p>Could not load the deck.<br>Reload the page, or check you are online for the first visit.</p>';
    return;
  }
  $('#boot-art').innerHTML = doodle('boat');
  byId = new Map(DECK.cards.map((c) => [c.i, c]));
  sectionOf = new Map(DECK.sections.map((s) => [s.k, s]));

  // drop history for cards that no longer exist
  for (const id of Object.keys(state.recs)) if (!byId.has(id)) delete state.recs[id];

  // Optional, and deliberately not awaited with the deck: no video map, or a
  // stale one, must never stop the cards loading.
  fetch('videos.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => { if (v && v.clips && v.cards) VIDEOS = v; })
    .catch(() => {});

  // Same deal for the figures: a card with a missing drawing is a card with
  // no drawing, never a card that fails to appear.
  fetch('figures.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((f) => { if (f) { FIGURES = f; const c = currentCard(); if (c) renderCardFigure(c); } })
    .catch(() => {});

  $('#search').placeholder = `Search ${DECK.cards.length} cards…`;
  wire();
  $('#boot').hidden = true;
  $('#app').hidden = false;
  go('home');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
