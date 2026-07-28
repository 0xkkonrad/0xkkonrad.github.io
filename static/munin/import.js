/* Drop it, get a receipt.
 *
 * The decision behind this screen (import, #6 in project.md) is that the thing
 * people lose in Anki's importer is not the cards — it is the *knowledge of
 * what happened to them*. "39 notes imported" is not an account. So the import
 * ends in a plain reckoning: what landed, what did not, and what changed on the
 * way. Nothing here is a progress bar with a checkmark at the end.
 *
 * Loaded on demand: the parsers are a good chunk of code and nobody who is
 * studying their own deck should be paying for them on every boot.
 */

import { readApkg, ApkgError } from './lib/anki.js';
import { buildDeck, RAVENS } from './lib/deck.js';
import * as store from './lib/store.js';
import { receiptHtml, ensureCss, doodle } from './lib/receipt.js';
import { validateDeck } from './lib/validate.js';

class Cancelled extends Error {}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => Number(v).toLocaleString('en-GB');

/* ── the screen ───────────────────────────────────────────────────────────── */

export function openImporter() {
  ensureCss();

  const el = document.createElement('div');
  el.className = 'imp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Import a deck');
  el.innerHTML = `<div class="imp-inner">
    <div class="imp-top">${doodle('carry')}<h2>your own deck</h2>
      <button type="button" class="imp-x" aria-label="Close">✕</button></div>
    <div class="imp-body"></div>
  </div>`;
  document.body.appendChild(el);
  const body = el.querySelector('.imp-body');

  // The screen underneath is fully covered, so it should also be out of reach:
  // without this, two Tabs from the importer land on the shelf behind it.
  const under = [document.getElementById('app'), document.querySelector('.shelf')].filter(Boolean);
  for (const u of under) u.inert = true;
  const escape = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', escape);

  const close = () => {
    removeEventListener('keydown', escape);
    for (const u of under) u.inert = false;
    el.remove();
  };
  el.querySelector('.imp-x').addEventListener('click', close);
  el.querySelector('.imp-x').focus();

  // Dragging a file needs something to drag with. On a phone the dashed
  // rectangle is decoration in front of the only control that works.
  const draggable = matchMedia('(hover: hover) and (pointer: fine)').matches;

  function pick() {
    body.innerHTML = `
      ${draggable ? `<div class="imp-drop" id="imp-drop">
        <b>drop an .apkg here</b>
        <p>your cards stay on this device</p>
      </div>` : ''}
      <button type="button" class="imp-file" id="imp-file">choose an .apkg${
  draggable ? '' : '<small>your cards stay on this device</small>'}</button>
      <input type="file" accept=".apkg,.colpkg,application/zip" hidden id="imp-input">
      <p class="imp-how">in anki: <b>File → Export</b>, choose <b>Anki Deck Package</b>, and
        include scheduling or not — it makes no difference, Munin starts every card new.
        Both the current format and the older one are read.</p>`;
    const input = body.querySelector('#imp-input');
    input.addEventListener('change', () => { if (input.files[0]) go(input.files[0]); });
    for (const opener of body.querySelectorAll('.imp-file, .imp-drop')) {
      opener.addEventListener('click', () => input.click());
    }

    const zone = body.querySelector('.imp-drop');
    if (!zone) return;
    for (const ev of ['dragenter', 'dragover']) {
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
    }
    for (const ev of ['dragleave', 'drop']) {
      zone.addEventListener(ev, () => zone.classList.remove('over'));
    }
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) go(f);
    });
  }

  // A page-wide drop target: aiming at a dashed rectangle with a file in hand
  // is a small indignity, and the whole screen is unambiguous.
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && body.querySelector('#imp-input')) go(f);
  });

  function working(line) {
    body.innerHTML = `<div class="imp-work">${doodle('perch')}
      <p id="imp-say">${esc(line)}</p>
      <div class="imp-bar"><i id="imp-bar"></i></div></div>`;
  }

  function fail(message, detail) {
    body.innerHTML = `<div class="imp-err"><b>${esc(message)}</b><p>${esc(detail || '')}</p></div>
      <div class="imp-acts"><button type="button" class="go" data-again>try another file</button></div>`;
    body.querySelector('[data-again]').addEventListener('click', pick);
  }

  async function go(file) {
    working('reading the package…');
    const say = body.querySelector('#imp-say');
    const bar = body.querySelector('#imp-bar');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    await frame();

    let built, col;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      col = await readApkg(bytes);
      built = await buildDeck(col, {
        fileName: file.name,
        // Closing the sheet mid-build should stop the build, not leave it
        // grinding through twenty thousand cards for a screen that is gone.
        yield: () => (el.isConnected ? frame() : Promise.reject(new Cancelled())),
        onProgress(done, total, stage) {
          say.textContent = total > 1 ? `${stage} — ${n(done)} of ${n(total)}` : stage + '…';
          bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
        },
      });
    } catch (e) {
      if (e instanceof Cancelled) return;
      console.error(e);
      if (e instanceof ApkgError) fail('that file could not be read', e.message);
      else if (e && /quota|storage/i.test(e.name + e.message)) {
        fail('there is no room for this deck', 'the browser is out of space for this site.');
      } else fail('something went wrong reading that deck', e?.message || String(e));
      return;
    }

    if (!built.deck.cards.length) {
      fail('nothing to study in that package',
        'every card in it came out empty. If it is a shared deck, it may use a note type whose templates are not in the file.');
      return;
    }

    // The same description of a deck that app.js checks at boot. A deck that
    // would not open is caught here, in front of the person who still has the
    // file, rather than on the next cold start with nothing to go back to.
    let v;
    try {
      v = validateDeck(built.deck);
    } catch (e) {
      console.error(e);
      v = { ok: false, errors: [e?.message || String(e)] };
    }
    if (!v.ok) {
      console.error('built deck:', v.errors);
      fail('that deck came out in a shape Munin cannot study', v.errors[0]);
      return;
    }

    // Reading the database can fail too — a locked-down or private browser
    // refuses to open it. This used to sit outside the catch above, so the
    // screen simply stopped, mid-progress, saying nothing.
    let existing = null;
    try {
      existing = match(await store.list(), built);
    } catch (e) {
      console.error(e);
      fail('this browser will not let Munin store anything',
        'private windows and some managed browsers block the local database Munin keeps decks in.');
      return;
    }
    body.innerHTML = receiptHtml(built.receipt, existing);
    body.querySelector('[data-cancel]').addEventListener('click', close);
    for (const b of body.querySelectorAll('[data-keep]')) {
      b.addEventListener('click', () => keep(built, b.dataset.keep === 'replace' ? existing : null));
    }
  }

  /* Two decks can reduce to the same title and share not one card — a
   * different export of a different subject called "Sailing". Offering to keep
   * your progress there is a promise the app cannot keep: app.js drops every
   * record whose card id is not in the deck, so the first boot after such a
   * replace silently wipes the lot. Match on the cards, and say which it is. */
  function match(decks, built) {
    const same = decks.filter((d) => d.title === built.deck.name);
    if (!same.length) return null;
    const mine = new Set(built.deck.cards.map((c) => c.i));
    for (const d of same) {
      const overlap = (d.ids || []).filter((i) => mine.has(i)).length;
      if (overlap && overlap >= Math.min(d.cards, mine.size) / 2) return { ...d, sameDeck: true };
    }
    return { ...same[0], sameDeck: false };
  }

  async function keep(built, replacing) {
    working('putting it away…');
    let id = replacing ? replacing.id : newId();
    if (!replacing) {
      // Date.now() alone collided when two tabs finished together, and the
      // second put simply overwrote the first deck.
      try {
        const taken = new Set((await store.list()).map((d) => d.id));
        while (taken.has(id)) id = newId();
      } catch { /* the put below reports a database that will not open */ }
    }
    try {
      await store.put({
        id,
        title: built.deck.name,
        created: replacing ? replacing.created : Date.now(),
        updated: Date.now(),
        cards: built.deck.cards.length,
        // Kept so a later import can tell "the same deck again" from "another
        // deck with the same name" without loading every card.
        ids: built.deck.cards.map((c) => c.i),
        art: RAVENS[Math.abs(hash(built.deck.name)) % RAVENS.length],
        sectionArt: built.sectionArt,
        groupArt: built.groupArt,
        receipt: built.receipt,
        deck: built.deck,
      }, built.media);
    } catch (e) {
      console.error(e);
      fail('the deck could not be saved',
        /quota|space/i.test(e?.name + e?.message)
          ? 'the browser is out of space for this site. Removing a deck you no longer study will free it.'
          : e?.message || String(e));
      return;
    }
    // The deck you just imported is the one you meant to study.
    localStorage.setItem(globalThis.MUNIN.lastKey, id);
    location.reload();
  }

  pick();
}

const newId = () => 'local-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
