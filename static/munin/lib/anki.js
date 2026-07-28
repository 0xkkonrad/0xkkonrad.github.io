/* Reading an .apkg into something Munin can talk about.
 *
 * An .apkg is a zip holding a SQLite collection and a pile of numbered media
 * files. What is in the collection has changed twice:
 *
 *   legacy      collection.anki2   schema 11, note types and decks as JSON
 *               collection.anki21  the same, deflated by the zip
 *   since 2.1.50 collection.anki21b schema 18, zstd, note types across tables
 *               and their formats inside protobuf blobs
 *
 * The modern export also writes a *decoy* collection.anki2 whose only content is
 * a note telling old Anki to upgrade. Picking the first file that looks like a
 * collection therefore imports an empty deck, which is exactly the kind of
 * silent nonsense the receipt exists to prevent — so the newest wins.
 */

import { readZip, ZipError } from './unzip.js';
import { openDb, SqliteError } from './sqlite.js';
import { decompress as unzstd } from './vendor/fzstd.js';

export class ApkgError extends Error {}

const dec = new TextDecoder();
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];

const isZstd = (b) => b.length > 4 && ZSTD.every((v, i) => b[i] === v);

/** zstd if it needs it, as-is if it does not. */
function maybeUnzstd(bytes) {
  return isZstd(bytes) ? unzstd(bytes) : bytes;
}

/* ── protobuf, only as much as the modern schema needs ─────────────────────
 * Field numbers from anki/proto: Notetype.Config.kind = 1,
 * Notetype.Template.Config.{q_format = 1, a_format = 2},
 * MediaEntries.entries = 1 with MediaEntry.{name = 1, legacy_zip_filename = 255}. */

function pbVarint(b, at) {
  let v = 0, shift = 1;
  for (let i = 0; i < 10; i++) {
    const byte = b[at + i];
    if (byte === undefined) throw new ApkgError('truncated protobuf');
    v += (byte & 0x7f) * shift;
    if (!(byte & 0x80)) return [v, at + i + 1];
    shift *= 128;
  }
  throw new ApkgError('impossible protobuf varint');
}

function* pbFields(b) {
  let at = 0;
  while (at < b.length) {
    const [key, a1] = pbVarint(b, at);
    const no = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) { const [v, a2] = pbVarint(b, a1); yield { no, wire, v }; at = a2; }
    else if (wire === 1) { yield { no, wire, v: b.subarray(a1, a1 + 8) }; at = a1 + 8; }
    else if (wire === 2) {
      const [len, a2] = pbVarint(b, a1);
      yield { no, wire, v: b.subarray(a2, a2 + len) };
      at = a2 + len;
    } else if (wire === 5) { yield { no, wire, v: b.subarray(a1, a1 + 4) }; at = a1 + 4; }
    else throw new ApkgError(`protobuf wire type ${wire}`);
  }
}

function pbGet(bytes, no) {
  if (!bytes || !bytes.length) return null;
  for (const f of pbFields(bytes)) if (f.no === no) return f.v;
  return null;
}

const pbString = (bytes, no) => {
  const v = pbGet(bytes, no);
  return v && v.length !== undefined ? dec.decode(v) : '';
};

/* ── the collection ───────────────────────────────────────────────────────── */

const COLLECTIONS = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

function pickCollection(zip) {
  for (const n of COLLECTIONS) if (zip.has(n)) return n;
  // A .colpkg (a whole-collection backup) is the same shape with a different
  // name, and importing one is a perfectly reasonable thing to want.
  const alt = zip.names.find((n) => /^collection\.anki2\d?b?$/.test(n));
  if (alt) return alt;
  throw new ApkgError('this zip has no Anki collection in it — is it really a .apkg?');
}

function notetypesFromTables(db) {
  const out = new Map();
  for (const r of db.each('notetypes')) {
    out.set(Number(r.id), {
      id: Number(r.id),
      name: String(r.name ?? ''),
      cloze: Number(pbGet(r.config, 1) ?? 0) === 1,
      fields: [],
      templates: [],
    });
  }
  const fields = [];
  for (const r of db.each('fields')) fields.push(r);
  fields.sort((a, b) => Number(a.ord) - Number(b.ord));
  for (const r of fields) {
    out.get(Number(r.ntid))?.fields.push(String(r.name ?? ''));
  }
  const tmpls = [];
  for (const r of db.each('templates')) tmpls.push(r);
  tmpls.sort((a, b) => Number(a.ord) - Number(b.ord));
  for (const r of tmpls) {
    out.get(Number(r.ntid))?.templates.push({
      ord: Number(r.ord),
      name: String(r.name ?? ''),
      qfmt: pbString(r.config, 1),
      afmt: pbString(r.config, 2),
    });
  }
  return out;
}

function notetypesFromJson(json) {
  const out = new Map();
  for (const m of Object.values(json || {})) {
    const flds = (m.flds || []).slice().sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    const tmpls = (m.tmpls || []).slice().sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0));
    out.set(Number(m.id), {
      id: Number(m.id),
      name: String(m.name ?? ''),
      cloze: Number(m.type ?? 0) === 1,
      fields: flds.map((f) => String(f.name ?? '')),
      templates: tmpls.map((t, i) => ({
        ord: Number(t.ord ?? i),
        name: String(t.name ?? ''),
        qfmt: String(t.qfmt ?? ''),
        afmt: String(t.afmt ?? ''),
      })),
    });
  }
  return out;
}

function decksFromTable(db) {
  const out = new Map();
  for (const r of db.each('decks')) {
    // The modern schema separates the levels with 0x1f instead of "::".
    out.set(Number(r.id), String(r.name ?? '').replaceAll('\x1f', '::'));
  }
  return out;
}

function decksFromJson(json) {
  const out = new Map();
  for (const d of Object.values(json || {})) out.set(Number(d.id), String(d.name ?? ''));
  return out;
}

/** The media map: name → the member of the zip holding its bytes. */
function readMediaMap(raw) {
  const bytes = maybeUnzstd(raw);
  if (bytes[0] === 0x7b) {                       // "{" — the legacy JSON map
    const map = JSON.parse(dec.decode(bytes));
    return new Map(Object.entries(map).map(([member, name]) => [String(name), String(member)]));
  }
  const out = new Map();
  let i = 0;
  for (const f of pbFields(bytes)) {
    if (f.no !== 1 || f.wire !== 2) continue;
    const name = pbString(f.v, 1);
    const legacy = pbGet(f.v, 255);
    out.set(name, String(legacy === null ? i : legacy));
    i++;
  }
  return out;
}

/**
 * Open a .apkg.
 * @param {Uint8Array} bytes
 * @returns a collection: note types, decks, notes, cards, and media by name
 */
export async function readApkg(bytes) {
  let zip;
  try {
    zip = readZip(bytes);
  } catch (e) {
    if (e instanceof ZipError) throw new ApkgError(`this file is not a readable .apkg — ${e.message}`);
    throw e;
  }

  const member = pickCollection(zip);
  let db;
  try {
    db = openDb(maybeUnzstd(await zip.read(member)));
  } catch (e) {
    if (e instanceof SqliteError || e instanceof ZipError) {
      // The reason is a detail of the SQLite file format — "impossible page
      // size" is true and useless. What a person can do about it is export the
      // deck again; the detail goes to the console for whoever is debugging.
      console.error('collection unreadable:', e.message);
      throw new ApkgError('the collection inside this .apkg could not be read — the file looks damaged. '
        + 'Exporting it from Anki again usually fixes it.');
    }
    throw e;
  }
  for (const t of ['notes', 'cards']) {
    if (!db.has(t)) throw new ApkgError(`the collection has no ${t} table — this is not an Anki export`);
  }

  // Everything from here reads tables, and a SqliteError escaping raw would
  // reach the importer as an unknown crash rather than as "this file is bad".
  try {
    return assemble(db, zip, member);
  } catch (e) {
    if (e instanceof SqliteError) {
      console.error('collection unreadable:', e.message);
      throw new ApkgError('this .apkg could not be read — the collection inside it is not shaped '
        + 'like one Anki writes.');
    }
    throw e;
  }
}

async function assemble(db, zip, member) {
  const col = db.has('col') ? db.rows('col')[0] : null;
  const modern = db.has('notetypes');
  const notetypes = modern ? notetypesFromTables(db)
    : notetypesFromJson(JSON.parse(String(col?.models || '{}')));
  const decks = (db.has('decks') && db.columnsOf('decks').includes('name'))
    ? decksFromTable(db)
    : decksFromJson(JSON.parse(String(col?.decks || '{}')));

  // A media map we cannot parse means a deck with no pictures, not a deck that
  // cannot be opened: "protobuf wire type 7" is not a sentence anyone can act on.
  let media = new Map();
  if (zip.has('media')) {
    try {
      media = readMediaMap(await zip.read('media'));
    } catch (e) {
      console.error('media map unreadable:', e.message);
    }
  }

  return {
    zip,
    member,
    schema: Number(col?.ver ?? (modern ? 18 : 11)),
    notetypes,
    decks,
    media,
    /** Notes, streamed — a big collection should not be built twice in memory. */
    notes: () => db.each('notes'),
    cards: () => db.each('cards'),
    noteCount: () => { let n = 0; for (const _ of db.each('notes')) n++; return n; },
    /** One media file's bytes, decompressed if the export was a modern one. */
    async mediaBytes(name) {
      const member2 = media.get(name);
      if (member2 === undefined || !zip.has(member2)) return null;
      return maybeUnzstd(await zip.read(member2));
    },
  };
}
