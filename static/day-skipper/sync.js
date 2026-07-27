/* Cross-device sync.
 *
 * No accounts, no email, no password. You generate a key on one device and type
 * or paste it into the next; knowing the key IS the permission. The key never
 * leaves the device — only its SHA-256 goes over the wire — so the server holds
 * a blob it cannot read the owner of, and a database leak hands nobody a login.
 *
 * No dependency and no bundler: the whole server API is two POSTs, and pulling
 * in a 50 KB client for that would cost the app its "works offline, no network
 * after first load" property for no benefit.
 *
 * Everything here is pure except `rpc` and the localStorage helpers, so the
 * merge — the only part that can silently lose someone's revision history — is
 * testable without a server. See tests/sync-merge.mjs.
 */
'use strict';

(function (root) {

const ENDPOINT = 'https://dyaxdgpaideblyhpxyft.supabase.co';
// Publishable by design: this key is in the page source of every install, and
// it grants nothing on its own. All it can do is call the two functions below,
// both of which demand a key hash the caller has to already know.
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5YXhkZ3BhaWRlYmx5aHB4eWZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMTg2MjUsImV4cCI6MjEwMDY5NDYyNX0.CDDeyQso3XnxiYg0f5x4uy99n6JoyHgEqm1cJN0wvIk';
const APP = 'day-skipper';
const LS = 'rya-ds/sync';

// Crockford's alphabet: no I, L, O or U, so a key read down a phone line or off
// a screen has no character pairs a person can confuse. 25 characters is 125
// bits, which is not guessable by anyone, ever.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_CHARS = 25;
const GROUP = 5;

// The server refuses a second write to the same key inside a second. Retrying
// faster than that just burns a round trip on a guaranteed rejection.
const RETRY_WAIT = 1200;
const MAX_ROUNDS = 4;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : (d || 0));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── keys ─────────────────────────── */

function makeKey() {
  const bytes = new Uint8Array(KEY_CHARS);
  crypto.getRandomValues(bytes);
  // One character per byte and mask to 32: modulo would bias the first 8 letters
  // of the alphabet, and the whole point of the key is that it is uniform.
  let s = '';
  for (let i = 0; i < KEY_CHARS; i++) s += B32[bytes[i] & 31];
  return s;
}

/** Accept anything a human might hand back: lower case, spaces, the dashes we
 *  printed, and the three letters people substitute for digits. */
function normaliseKey(input) {
  const s = String(input || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  for (const ch of s) if (!B32.includes(ch)) return null;
  return s.length === KEY_CHARS ? s : null;
}

/** Dashed for reading aloud and for typing without losing your place. Only ever
 *  for display — the hash is always taken over the bare form. */
function formatKey(key) {
  return (key.match(new RegExp('.{1,' + GROUP + '}', 'g')) || []).join('-');
}

async function hashKey(key) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  // Lower case is not cosmetic: the server rejects uppercase hex outright, so
  // that one blob cannot end up under two spellings of the same key.
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ─────────────────────────── local record ─────────────────────────── */

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || 'null');
    if (!raw || typeof raw.key !== 'string') return null;
    const key = normaliseKey(raw.key);
    if (!key) return null;
    return { key, rev: num(raw.rev), at: num(raw.at), err: raw.err || '' };
  } catch (e) {
    return null;
  }
}

function writeLocal(rec) {
  try {
    localStorage.setItem(LS, JSON.stringify(rec));
  } catch (e) {
    /* storage full: sync still works this session, it just will not resume */
  }
}

/* ─────────────────────────── merge ─────────────────────────── */

/* The rule everywhere below is: never let a merge lose a review, and never let
 * running the same merge twice change the answer. Both matter — the second
 * because a blob is merged again on every device, every sync, for ever, and
 * anything that accumulates (summing two counters, say) drifts upward without
 * bound. So: max, min and pick-a-winner only. Nothing adds. */

/** Which of two records for the same card is further along.
 *
 * Reps only ever increase, so more reps is strictly more history — this is the
 * whole reason the app can get away without a CRDT. The rest is tie-breaking,
 * and exists only so merge(a, b) and merge(b, a) cannot disagree. */
function pickRec(x, y) {
  if (!x) return y;
  if (!y) return x;
  if (num(x.rp) !== num(y.rp)) return num(x.rp) > num(y.rp) ? x : y;
  // Same rep count: the later due date is the more advanced schedule.
  if (num(x.due) !== num(y.due)) return num(x.due) > num(y.due) ? x : y;
  if (num(x.lp) !== num(y.lp)) return num(x.lp) < num(y.lp) ? x : y;
  return stable(x) <= stable(y) ? x : y;
}

/** JSON with the keys in a fixed order, so two objects that mean the same thing
 *  compare equal regardless of how they were built. */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

function prevKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
       + '-' + String(dt.getDate()).padStart(2, '0');
}

/** Count back from the last day studied over consecutive calendar days.
 *
 * Recomputed rather than taken from either side, because a streak is a fact
 * about `days` and two devices each hold a partial view of it: device A studied
 * Mon and Wed, device B studied Tue, and neither one is looking at a streak of
 * three until the histories are put together.
 *
 * This under-reports on its own, because `days` is pruned to 90 entries and a
 * longer run than that simply is not in the record any more. The caller makes
 * up the difference from the stored counters. */
function streakFrom(days, lastDay) {
  if (!lastDay || !days[lastDay]) return 0;
  let n = 0;
  for (let k = lastDay; days[k]; k = prevKey(k)) n++;
  return n;
}

/** Merge two sanitised states into one. Commutative, idempotent, and total.
 *
 * Both arguments must already have been through the app's `sanitise` — this
 * function trusts the shapes it is given and only reasons about values. */
function mergeState(a, b) {
  a = obj(a); b = obj(b);
  const out = {};

  out.v = Math.max(num(a.v, 1), num(b.v, 1));

  // Per-card history: the further-along record wins outright. Fields are never
  // mixed between two records — an interval from one device with an ease from
  // the other describes a review that never happened.
  out.recs = {};
  for (const id of new Set(Object.keys(obj(a.recs)).concat(Object.keys(obj(b.recs))))) {
    out.recs[id] = pickRec(obj(a.recs)[id], obj(b.recs)[id]);
  }

  // Per-day answer counts: max, not sum.
  //
  // Sum would be right for a single merge and wrong for every one after it —
  // the same day's answers would be added again on each sync until the ship's
  // log claimed a thousand-card Tuesday. The cost of max is real but small:
  // study the same day on two devices and that day reports the busier of the
  // two rather than the total.
  const days = {};
  for (const k of new Set(Object.keys(obj(a.days)).concat(Object.keys(obj(b.days))))) {
    days[k] = Math.max(num(obj(a.days)[k]), num(obj(b.days)[k]));
  }

  out.day = (a.day || '') > (b.day || '') ? a.day : b.day;
  const la = a.lastDay || '', lb = b.lastDay || '';
  out.lastDay = (la > lb ? la : lb) || null;

  // Streak is computed before pruning: the answer depends on days the prune is
  // about to throw away.
  //
  // Then topped up from the stored counters, but only from a device that is
  // still on the same last day — that device's count covers the run that has
  // already aged out of `days`. A device stuck on an older last day is carrying
  // a streak that has since been broken, and taking its number would resurrect
  // a run the person did not keep.
  const carried = [a, b]
    .filter((s) => (s.lastDay || null) === out.lastDay)
    .map((s) => num(s.streak));
  out.streak = Math.max(streakFrom(days, out.lastDay), 0, ...carried);

  // Same 90-of-120 prune the app applies, so a merged blob is no bigger than
  // one the app would have written itself.
  const keys = Object.keys(days);
  if (keys.length > 120) {
    keys.sort();
    for (const k of keys.slice(0, keys.length - 90)) delete days[k];
  }
  out.days = days;

  // Today's counters belong to today. A device that has not rolled over yet is
  // carrying yesterday's numbers, and adopting those would re-cap the new-card
  // allowance for a day that has already been and gone.
  const todays = (s) => (s.day === out.day ? s : null);
  const ta = todays(a), tb = todays(b);
  out.newDone = Math.max(ta ? num(ta.newDone) : 0, tb ? num(tb.newDone) : 0);
  out.revDone = Math.max(ta ? num(ta.revDone) : 0, tb ? num(tb.revDone) : 0);

  // Lifetime counters: max. Under-counts when both devices were used between
  // syncs, which is the same trade as `days` above and for the same reason —
  // it can never run backwards, and it can never inflate.
  out.revTotal = Math.max(num(a.revTotal), num(b.revTotal));
  out.revGood = Math.min(out.revTotal,
    Math.max(num(a.revGood), num(b.revGood)));

  const summed = Object.values(days).reduce((t, v) => t + num(v), 0);
  out.answers = Math.max(summed, num(a.answers), num(b.answers));

  // A badge is unlocked once. Whichever device saw it first is when it happened,
  // so the ship's log reads as a history rather than as a sync log.
  out.ach = {};
  for (const [id, ts] of Object.entries(obj(a.ach)).concat(Object.entries(obj(b.ach)))) {
    const t = num(ts);
    if (t > 0 && (!out.ach[id] || t < out.ach[id])) out.ach[id] = t;
  }

  out.settings = mergeSettings(obj(a.settings), obj(b.settings));
  return out;
}

/** Settings are last-write-wins as a block, on a stamp the app sets whenever
 *  they change. Field-wise would be worse, not better: turning the daily limit
 *  down on the phone and the theme dark on the laptop should not produce a
 *  third combination neither device ever showed. */
function mergeSettings(x, y) {
  let win, lose;
  if (num(x.at) !== num(y.at)) {
    [win, lose] = num(x.at) > num(y.at) ? [x, y] : [y, x];
  } else {
    [win, lose] = stable(x) <= stable(y) ? [x, y] : [y, x];
  }
  const out = Object.assign({}, win);
  // One rescue on top of the block rule. An exam date is a fact about the
  // person, not a preference, and a device that never had one must not wipe it
  // off the device that did. `examSkipped` is how a deliberate "no date" is
  // recorded, so it is safe to tell the two apart.
  if (!out.examDate && !out.examSkipped && lose.examDate) out.examDate = lose.examDate;
  return out;
}

/* ─────────────────────────── transport ─────────────────────────── */

async function rpc(fn, body) {
  const r = await fetch(ENDPOINT + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: 'Bearer ' + ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* fall through to the error */ }
  if (!r.ok) {
    const e = new Error((parsed && parsed.message) || ('HTTP ' + r.status));
    e.code = parsed && parsed.code;
    throw e;
  }
  return parsed;
}

/* ─────────────────────────── the loop ─────────────────────────── */

let cfg = { sanitise: (s) => s, onMerged: () => {}, onStatus: () => {} };
let running = null;
let pending = null;
let timer = null;

function enabled() { return !!readLocal(); }
function status() {
  const rec = readLocal();
  return rec ? { on: true, key: rec.key, at: rec.at, rev: rec.rev, err: rec.err }
             : { on: false };
}

/** Pull, merge, push. Returns the state the caller should now be holding.
 *
 * The order matters. Pushing first and merging only on rejection would be one
 * round trip cheaper, but it makes the common case — open the app on the second
 * device, having changed nothing — a write, and a write is the one operation
 * that can go wrong. */
async function syncOnce(local) {
  const rec = readLocal();
  if (!rec) throw new Error('sync is off');
  const hash = await hashKey(rec.key);

  let state = local;
  let rev = 0;
  let changed = false;

  const rows = await rpc('sync_get', { p_app: APP, p_key_hash: hash });
  if (Array.isArray(rows) && rows.length) {
    rev = num(rows[0].rev);
    // The blob is only as trustworthy as the key that wrote it, which is to say
    // trustworthy enough — but it has still been through a network and a
    // database, so it goes through the same front door as a restored file.
    const remote = cfg.sanitise(rows[0].data);
    const merged = mergeState(local, remote);
    changed = stable(merged) !== stable(remote);
    state = merged;
  } else {
    changed = true;                          // nothing stored yet; this is the first
  }

  for (let i = 0; changed && i < MAX_ROUNDS; i++) {
    let res;
    try {
      res = await rpc('sync_put',
        { p_app: APP, p_key_hash: hash, p_rev: rev, p_data: state });
    } catch (e) {
      // The server allows one write per key per second. Two triggers landing
      // together — finishing a session and then immediately backgrounding the
      // app — is not a failure, it is a reason to wait as long as it asked.
      // Reporting it as one strands the change until something syncs again.
      if (e.code === '53400' && i < MAX_ROUNDS - 1) {
        await sleep(RETRY_WAIT);
        continue;
      }
      throw e;
    }
    const row = Array.isArray(res) ? res[0] : res;
    if (row && row.ok) {
      rev = num(row.rev);
      changed = false;
      break;
    }
    // Somebody else wrote between our read and our write. Their blob comes back
    // with the rejection, so the fix is to fold it in and try again rather than
    // to ask the user to pick a winner.
    rev = num(row && row.rev);
    const theirs = cfg.sanitise(row && row.data);
    state = mergeState(state, theirs);
    changed = stable(state) !== stable(theirs);
    if (changed) await sleep(RETRY_WAIT);
  }

  writeLocal({ key: rec.key, rev, at: Date.now(), err: '' });
  return state;
}

/** Serialised: two syncs in flight would each merge against a blob the other is
 *  about to replace, and the loser's work would be written and then overwritten.
 *
 *  Serialised, not coalesced. Handing a second caller the in-flight promise
 *  looks equivalent and is not: that sync was built from a snapshot taken
 *  before whatever the caller is ringing about, so the change would sit
 *  unsent until something else happened to trigger a sync. Queue behind it
 *  instead, and read the state again when our turn comes — which is why
 *  callers pass a function rather than a value. */
function sync(source) {
  if (running) {
    if (!pending) {
      pending = running.catch(() => {}).then(() => { pending = null; return sync(source); });
    }
    return pending;
  }
  cfg.onStatus({ busy: true });
  running = syncOnce(typeof source === 'function' ? source() : source)
    .then((merged) => {
      cfg.onMerged(merged);
      cfg.onStatus({ busy: false, ok: true, at: Date.now() });
      return merged;
    })
    .catch((e) => {
      const rec = readLocal();
      if (rec) writeLocal(Object.assign({}, rec, { err: e.message || 'failed' }));
      cfg.onStatus({ busy: false, ok: false, error: e.message || 'failed' });
      throw e;
    })
    .finally(() => { running = null; });
  return running;
}

/** Coalesce the burst of saves at the end of a session into one upload, and
 *  stay clear of the server's one-write-per-second ceiling while doing it. */
function schedule(getState, ms) {
  if (!enabled()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { sync(getState).catch(() => {}); }, ms || 5000);
}

function turnOn(key) {
  const k = key ? normaliseKey(key) : makeKey();
  if (!k) return null;
  writeLocal({ key: k, rev: 0, at: 0, err: '' });
  return k;
}

function turnOff() {
  try { localStorage.removeItem(LS); } catch (e) { /* nothing to do */ }
  clearTimeout(timer);
}

root.DSSync = {
  init(options) { cfg = Object.assign(cfg, options || {}); },
  enabled, status, sync, schedule, turnOn, turnOff,
  makeKey, normaliseKey, formatKey, hashKey,
  // Exported for tests/sync-merge.mjs — the merge is the part worth proving.
  mergeState, mergeSettings, pickRec, streakFrom, stable,
  KEY_CHARS, APP, ENDPOINT,
};

})(typeof globalThis !== 'undefined' ? globalThis : this);
