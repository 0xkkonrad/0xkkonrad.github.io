import { API_URL } from './config.js';
import { AVATAR_IDS, DEFAULT_AVATARS } from './avatars.js';

const PREFIX = 'swearjar:v1:';
const SECRET_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const DEFAULT_NAMES = ['Goblin', 'Gremlin'];
export function validEvent(e) {
  return e && UUID_RE.test(e.id) && [0, 1].includes(e.player) &&
    ['swear', 'undo', 'rename', 'avatar'].includes(e.type) &&
    typeof e.at === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(e.at) && Number.isFinite(Date.parse(e.at)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.day) && Number.isInteger(e.hour) && e.hour >= 0 && e.hour <= 23 &&
    (e.type !== 'undo' || UUID_RE.test(e.target)) &&
    (e.type !== 'rename' || (typeof e.name === 'string' && e.name.trim().length > 0 && e.name === e.name.trim() && !/[\x00-\x1f\x7f]/.test(e.name) && [...e.name].length <= 24)) &&
    (e.type !== 'avatar' || AVATAR_IDS.includes(e.avatar));
}
export function activeEvents(events) {
  const undone = new Set(events.filter(e => e.type === 'undo').map(e => e.target));
  return events.filter(e => e.type === 'swear' && !undone.has(e.id));
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function extractSecret(value) {
  if (typeof value !== 'string') return null;
  value = value.trim();
  if (SECRET_RE.test(value)) return value;
  try { const s = new URL(value).hash.match(/(?:^#|&)jar=([a-f0-9]{64})(?:&|$)/)?.[1]; return s || null; }
  catch { return null; }
}

/** Append-only local records avoid lost writes between two tabs. Sheets is the shared event log. */
export function createStore(options = {}) {
  let storage;
  try { storage = options.storage || globalThis.localStorage; }
  catch { storage = {getItem(){throw new Error('Storage unavailable');},setItem(){throw new Error('Storage unavailable');}}; }
  const transport = options.fetch || globalThis.fetch.bind(globalThis);
  const location = options.location || globalThis.location;
  const crypto = options.crypto || globalThis.crypto;
  const api = options.api ?? API_URL;
  const listeners = new Set();
  let events = new Map(), acknowledged = new Set(), timer, flight, destroyed = false, epoch = 0;
  let status = 'local', error = null, lastSync = null, secret, identitySaved = false;
  const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  const key = () => `${PREFIX}${secret}:`;
  const ordered = () => [...events.values()].sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  function getState() {
    const all = ordered();
    const names = [...DEFAULT_NAMES];
    const avatars = [...DEFAULT_AVATARS];
    for (const event of all) if (event.type === 'rename') names[event.player] = event.name;
    for (const event of all) if (event.type === 'avatar') avatars[event.player] = event.avatar;
    return { jarId: secret.slice(0, 12), secret, names, avatars, events: all, status, error, lastSync,
      pending: all.filter(e => !acknowledged.has(e.id)).length };
  }
  function emit() { if (!destroyed) for (const fn of listeners) fn(getState()); }
  function storageError() {
    status = 'error'; error = 'This browser could not save your jar. Free some storage or allow site data, then try again. Export your jar before leaving.'; emit();
  }
  function readLocal() {
    const base = key();
    try {
      for (let i=0; i<storage.length; i++) {
        const k=storage.key(i);
        if (!k?.startsWith(base)) continue;
        if (k.startsWith(base+'event:')) {
          let event; try { event=JSON.parse(storage.getItem(k)); } catch { continue; }
          if (validEvent(event)) events.set(event.id,event);
        } else if (k.startsWith(base+'ack:')) acknowledged.add(k.slice((base+'ack:').length));
      }
    } catch { storageError(); }
  }
  try {
    const incoming = extractSecret(location?.href || '');
    const previous = storage.getItem(PREFIX+'current');
    secret = incoming || (SECRET_RE.test(previous) ? previous : randomSecret());
    if (previous !== secret) storage.setItem(PREFIX+'current', secret);
    identitySaved = true;
    if (incoming && !options.location && globalThis.history) {
      const clean = new URL(location.href); clean.hash='';
      globalThis.history.replaceState(null,'',clean);
    }
  } catch { secret ||= randomSecret(); storageError(); }
  readLocal();
  function ensureIdentity() {
    if (identitySaved) return;
    try { storage.setItem(PREFIX+'current', secret); identitySaved = true; }
    catch { storageError(); throw new Error(error); }
  }
  function schedule(delay = 700) { clearTimeout(timer); if (!destroyed && options.autoSync !== false) timer=setTimeout(() => void sync(),delay); }
  async function append(type, player, extra={}) {
    if (![0,1].includes(player)) throw new Error('Choose one of the two people.');
    ensureIdentity();
    const now = new Date();
    // Monotonic timestamps make same-device rename ordering deterministic, including fast edits.
    const newest = Math.max(0, ...[...events.values()].map(e => Date.parse(e.at)));
    const at = new Date(Math.max(now.getTime(),Math.min(newest + 1,now.getTime()+1000))).toISOString();
    const event={id:crypto.randomUUID(),type,player,at,day:localDay(now),hour:now.getHours(),...extra};
    if (!validEvent(event)) throw new Error('That change is not valid. Names can be up to 24 characters.');
    try { storage.setItem(key()+'event:'+event.id,JSON.stringify(event)); }
    catch { storageError(); throw new Error(error); }
    events.set(event.id,event); status='local'; error=null; emit(); schedule(); return event;
  }
  async function performSync() {
    if (!api) { status='local'; emit(); return; }
    if (globalThis.navigator?.onLine === false) { status='offline'; emit(); return; }
    const runEpoch=epoch, runSecret=secret, runKey=key();
    status='syncing'; error=null; emit();
    try {
      ensureIdentity();
      readLocal();
      let rounds=0;
      do {
        // Send unsynced swears before their undo records even if the device clock moved backwards.
        const pending=ordered().filter(e=>!acknowledged.has(e.id)).sort((a,b)=>Number(a.type==='undo')-Number(b.type==='undo')).slice(0,200);
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),25000);
        let response;
        try { response=await transport(api+'/sync',{method:'POST',credentials:'omit',cache:'no-store',
          headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:runSecret,events:pending,protocol:2}),signal:controller.signal}); }
        finally { clearTimeout(timeout); }
        if (!response.ok) throw new Error(response.status===429 ? 'The jar needs a breather. Your swears are saved here; sync will retry.' : 'The shared jar is temporarily unavailable. Your swears are saved here.');
        const data=await response.json();
        if (epoch!==runEpoch) return;
        if (!Array.isArray(data.events) || !Array.isArray(data.ack) || !data.events.every(validEvent)) throw new Error('The jar sent an unexpected response. Your local swears are safe.');
        // A server response is the durable proof of each record; acknowledgement follows local persistence.
        for (const event of data.events) {
          if (!events.has(event.id)) {
            try { storage.setItem(runKey+'event:'+event.id,JSON.stringify(event)); }
            catch { storageError(); throw new Error(error); }
            events.set(event.id,event);
          }
        }
        for (const id of new Set([...data.ack,...data.events.map(e=>e.id)])) {
          if (!events.has(id)) continue;
          try { storage.setItem(runKey+'ack:'+id,'1'); }
          catch { storageError(); throw new Error(error); }
          acknowledged.add(id);
        }
        rounds++;
        if (!pending.length || !pending.some(e=>acknowledged.has(e.id))) break;
      } while (ordered().some(e=>!acknowledged.has(e.id)) && rounds<20);
      status=ordered().some(e=>!acknowledged.has(e.id))?'local':'synced';
      lastSync=new Date().toISOString(); error=null; emit();
      if (status==='local') schedule(3000);
    } catch (e) {
      if (epoch!==runEpoch) return;
      status=globalThis.navigator?.onLine===false?'offline':'error';
      error=e.name==='AbortError'?'Sync took too long. Your swears are saved here; we’ll retry.':e.message || 'Sync failed. Your swears are saved here.';
      emit(); schedule(30000);
    }
  }
  function sync() {
    if (destroyed) return Promise.resolve();
    if (flight) return flight;
    flight=performSync().finally(()=>{flight=null;}); return flight;
  }
  const onStorage = e => {
    if (!e.key?.startsWith(key())) return;
    readLocal(); emit(); schedule(1000);
  };
  const onOnline = () => schedule(50);
  const onOffline = () => {status='offline';emit();};
  const onVisible = () => {if (!globalThis.document?.hidden) schedule(200);};
  if (!options.storage) {
    globalThis.addEventListener?.('storage',onStorage);
    globalThis.addEventListener?.('online',onOnline);
    globalThis.addEventListener?.('offline',onOffline);
    globalThis.addEventListener?.('pageshow',onVisible);
    globalThis.document?.addEventListener('visibilitychange',onVisible);
  }
  schedule(100);
  return {
    getState,
    subscribe(fn) {listeners.add(fn); fn(getState()); return ()=>listeners.delete(fn);},
    addSwear(player) {return append('swear',player);},
    undo(id) {
      const active=activeEvents(ordered());
      const target=id?active.find(e=>e.id===id):active.at(-1);
      if (!target) return Promise.resolve(null);
      return append('undo',target.player,{target:target.id});
    },
    rename(player,name) {return append('rename',player,{name:String(name).trim()});},
    setAvatar(player,avatar) {
      if (!AVATAR_IDS.includes(avatar)) return Promise.reject(new Error('Choose an avatar from the picker.'));
      return append('avatar',player,{avatar});
    },
    sync,
    getInviteUrl() {const url=new URL(location?.href||'https://kkonrad.com/swear-jar/');url.search='';url.hash='jar='+secret;return url.href;},
    exportData() {return {app:'Swear Jar',version:1,exportedAt:new Date().toISOString(),inviteUrl:this.getInviteUrl(),...getState()};},
    async joinJar(value) {
      const target=extractSecret(value);
      if (!target) throw new Error('Paste the full private jar link.');
      try {storage.setItem(PREFIX+'current',target);} catch {storageError();throw new Error(error);}
      epoch++; secret=target;identitySaved=true;events=new Map();acknowledged=new Set();lastSync=null;status='local';error=null;readLocal();emit();
      if (flight) await flight;
      await sync();
    },
    destroy() {
      destroyed=true;clearTimeout(timer);listeners.clear();
      globalThis.removeEventListener?.('storage',onStorage);globalThis.removeEventListener?.('online',onOnline);
      globalThis.removeEventListener?.('offline',onOffline);globalThis.removeEventListener?.('pageshow',onVisible);
      globalThis.document?.removeEventListener('visibilitychange',onVisible);
    }
  };
}
