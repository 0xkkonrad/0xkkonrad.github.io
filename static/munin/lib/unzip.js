/* Reading a .apkg means reading a zip, and a zip is a directory at the end of
 * the file plus a pile of members. We only ever read — no writing, no streaming
 * — so this is the central directory, and one member at a time.
 *
 * Decompression is the platform's: DecompressionStream('deflate-raw') has been
 * in every browser we target for years, and it is the same code path Chrome
 * uses for the network, so it is faster and better tested than anything we
 * would ship. Zstd is the exception — nobody exposes it — and that is why
 * vendor/fzstd.js exists.
 */

const EOCD = 0x06054b50;      // end of central directory
const EOCD64 = 0x06064b50;    // ...and its zip64 replacement
const LOC64 = 0x07064b50;     // the locator that points at it
const CEN = 0x02014b50;       // a central directory entry
const LOC = 0x04034b50;       // a local file header

const dec = new TextDecoder();

export class ZipError extends Error {}

/** Anki writes plain ASCII names, but a deck's media can be anything. */
function name(bytes, at, len, utf8) {
  const raw = bytes.subarray(at, at + len);
  if (utf8) return dec.decode(raw);
  // CP437 for the handful of old zips that never set the unicode flag. The
  // low half is ASCII; above that we would be guessing, so we keep the bytes
  // legible rather than correct.
  let s = '';
  for (const b of raw) s += b < 0x80 ? String.fromCharCode(b) : '�';
  return s;
}

/* A zip64 extra field carries the real sizes when the 32-bit ones are
 * saturated. Order matters and fields are only present if their 32-bit
 * counterpart was 0xFFFFFFFF, so this reads positionally. */
function zip64Extra(dv, at, len, e) {
  const end = at + len;
  while (at + 4 <= end) {
    const id = dv.getUint16(at, true), size = dv.getUint16(at + 2, true);
    let p = at + 4;
    if (id === 0x0001) {
      if (e.size === 0xFFFFFFFF && p + 8 <= end) { e.size = Number(dv.getBigUint64(p, true)); p += 8; }
      if (e.csize === 0xFFFFFFFF && p + 8 <= end) { e.csize = Number(dv.getBigUint64(p, true)); p += 8; }
      if (e.offset === 0xFFFFFFFF && p + 8 <= end) { e.offset = Number(dv.getBigUint64(p, true)); p += 8; }
      return;
    }
    at += 4 + size;
  }
}

/** Where the directory starts, and how many entries it holds. */
function findDirectory(bytes, dv) {
  // The comment field means the record is not at a fixed offset; 22 bytes of
  // record plus at most 65535 of comment is the whole search space.
  const min = Math.max(0, bytes.length - 22 - 0xFFFF);
  let at = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === EOCD) { at = i; break; }
  }
  if (at < 0) throw new ZipError('not a zip file');

  let count = dv.getUint16(at + 10, true);
  let start = dv.getUint32(at + 16, true);

  // Sixty-five thousand members sounds absurd until you meet a deck with a
  // photo on every card. Past that the counts saturate and the real ones live
  // in a second record, found through a locator just before this one.
  // 65535 is a count, not a marker: a conformant writer with exactly that many
  // members emits it with no zip64 record anywhere. Only the locator sitting
  // where it should be means the real numbers are elsewhere.
  const locAt = at - 20;
  const hasLocator = locAt >= 0 && dv.getUint32(locAt, true) === LOC64;
  if (hasLocator && (count === 0xFFFF || start === 0xFFFFFFFF)) {
    const at64 = Number(dv.getBigUint64(locAt + 8, true));
    if (at64 < 0 || at64 + 56 > bytes.length || dv.getUint32(at64, true) !== EOCD64) {
      throw new ZipError('zip64 directory missing');
    }
    count = Number(dv.getBigUint64(at64 + 32, true));
    start = Number(dv.getBigUint64(at64 + 48, true));
  }
  return { count, start };
}

export class Zip {
  constructor(bytes, entries) {
    this.bytes = bytes;
    /** @type {Map<string, object>} */
    this.entries = entries;
  }

  has(n) { return this.entries.has(n); }
  get names() { return [...this.entries.keys()]; }

  /** The member's bytes, decompressed. Throws rather than returning short. */
  async read(n) {
    const e = this.entries.get(n);
    if (!e) throw new ZipError(`no member named ${n}`);
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    if (e.offset + 30 > this.bytes.length || dv.getUint32(e.offset, true) !== LOC) {
      throw new ZipError(`${n}: local header missing`);
    }
    // The local header repeats the name and the extra field, and its extra
    // field is routinely a different length from the directory's — so the data
    // offset has to be computed from the local header, never from the entry.
    const at = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
    const raw = this.bytes.subarray(at, at + e.csize);
    if (raw.length < e.csize) throw new ZipError(`${n}: truncated`);

    if (e.method === 0) return raw;
    if (e.method !== 8) throw new ZipError(`${n}: compression method ${e.method} is not supported`);
    let out;
    try {
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out = new Uint8Array(await new Response(s).arrayBuffer());
    } catch (err) {
      throw new ZipError(`${n}: could not be decompressed`);
    }
    // A member that inflates short is a corrupt file pretending to be a whole
    // one; letting it through would surface later as unreadable SQLite.
    if (e.size !== 0xFFFFFFFF && out.length !== e.size) throw new ZipError(`${n}: truncated`);
    return out;
  }
}

/** Parse the directory. Cheap — no member is touched until you read it. */
export function readZip(bytes) {
  if (bytes.length < 22) throw new ZipError('not a zip file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { count, start } = findDirectory(bytes, dv);

  const entries = new Map();
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || dv.getUint32(at, true) !== CEN) {
      throw new ZipError('the zip directory is damaged');
    }
    const flags = dv.getUint16(at + 8, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const e = {
      method: dv.getUint16(at + 10, true),
      csize: dv.getUint32(at + 20, true),
      size: dv.getUint32(at + 24, true),
      offset: dv.getUint32(at + 42, true),
    };
    const n = name(bytes, at + 46, nameLen, (flags & 0x800) !== 0);
    if (e.size === 0xFFFFFFFF || e.csize === 0xFFFFFFFF || e.offset === 0xFFFFFFFF) {
      zip64Extra(dv, at + 46 + nameLen, extraLen, e);
    }
    // Directories are members too, and an .apkg has none, but a zip made by
    // hand might; they read as empty and would only confuse the caller.
    if (!n.endsWith('/')) entries.set(n, e);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return new Zip(bytes, entries);
}
