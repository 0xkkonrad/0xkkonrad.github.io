'use strict';

const statusEl = document.getElementById('status');
const moveButton = document.getElementById('move');
const KEEPCLUB_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://127.0.0.1:8777/projects/keepclub/web'
  : 'https://keepclub.app';
const KEEPCLUB_ORIGIN = new URL(KEEPCLUB_URL).origin;

function say(message) {
  statusEl.textContent = message;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('local database could not be read'));
  });
}

async function openOldDatabase() {
  if (!('indexedDB' in window)) return null;
  if (indexedDB.databases) {
    try {
      const databases = await indexedDB.databases();
      if (!databases.some((db) => db.name === 'munin')) return null;
    } catch (error) {
      // Older browsers cannot list databases; opening it is the only check.
    }
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('munin', 1);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
      req.transaction.abort();
    };
    req.onsuccess = () => resolve(created ? null : req.result);
    req.onerror = () => {
      if (created || req.error?.name === 'AbortError') resolve(null);
      else reject(req.error || new Error('local database could not be opened'));
    };
  });
}

async function readDecks() {
  const db = await openOldDatabase();
  if (!db) return [];
  const names = ['decks', 'cards', 'media'];
  if (names.some((name) => !db.objectStoreNames.contains(name))) {
    db.close();
    return [];
  }

  const decks = await request(db.transaction('decks').objectStore('decks').getAll());
  const queued = decks.map((meta) => {
    const tx = db.transaction(['cards', 'media']);
    const cards = tx.objectStore('cards');
    const media = tx.objectStore('media');
    const range = IDBKeyRange.bound([meta.id], [meta.id, []]);
    return {
      meta,
      deck: request(cards.get(meta.id)),
      values: request(media.getAll(range)),
      keys: request(media.getAllKeys(range)),
    };
  });

  const bundles = [];
  for (const queuedDeck of queued) {
    const [deck, values, keys] = await Promise.all([
      queuedDeck.deck,
      queuedDeck.values,
      queuedDeck.keys,
    ]);
    if (!deck) continue;
    const converted = [];
    for (let i = 0; i < values.length; i++) {
      const item = values[i];
      converted.push({
        i: Number(keys[i] && keys[i][1]),
        name: item.name,
        kind: item.kind,
        bytes: new Uint8Array(await item.blob.arrayBuffer()),
      });
    }
    bundles.push({
      record: Object.assign({}, queuedDeck.meta, { deck }),
      media: converted,
    });
  }
  db.close();
  return bundles;
}

function readProgress() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === 'munin/theme' || key === 'munin/last-course'
        || key === 'munin/sync-off'
        || /^munin\/[a-z0-9][a-z0-9-]{0,63}\/state\/v1$/.test(key)) {
      entries.push([key, localStorage.getItem(key)]);
    }
  }
  return entries;
}

function token() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('');
}

moveButton.addEventListener('click', async () => {
  moveButton.disabled = true;
  say('Opening keepclub.app and reading the progress stored in this browser…');

  const moveToken = token();
  const target = window.open(KEEPCLUB_URL + '/#move=' + moveToken, '_blank');
  if (!target) {
    moveButton.disabled = false;
    say('Your browser blocked the new tab. Allow pop-ups for this page, then try again.');
    return;
  }

  let ready = false;
  let payload = null;
  const send = () => {
    if (!ready || !payload) return;
    say('Copying into keepclub.app…');
    target.postMessage({
      type: 'keepclub:migration',
      token: moveToken,
      payload,
    }, KEEPCLUB_ORIGIN);
  };

  const timeout = setTimeout(() => {
    removeEventListener('message', onMessage);
    moveButton.disabled = false;
    say('The move timed out. Nothing was deleted here; reload both pages and try again.');
  }, 120000);

  const onMessage = (event) => {
    if (event.origin !== KEEPCLUB_ORIGIN || event.source !== target
        || event.data?.token !== moveToken) return;
    if (event.data.type === 'keepclub:migration-ready') {
      ready = true;
      send();
      return;
    }
    if (event.data.type === 'keepclub:migration-complete') {
      clearTimeout(timeout);
      removeEventListener('message', onMessage);
      const result = event.data.result || {};
      say(`Move complete: ${result.histories || 0} progress records and `
        + `${result.imported || 0} imported decks copied. The originals remain here.`);
      return;
    }
    if (event.data.type === 'keepclub:migration-failed') {
      clearTimeout(timeout);
      removeEventListener('message', onMessage);
      moveButton.disabled = false;
      say('The move did not finish. Nothing was deleted here; try again.');
    }
  };
  addEventListener('message', onMessage);

  try {
    payload = { local: readProgress(), decks: await readDecks() };
    send();
  } catch (error) {
    clearTimeout(timeout);
    removeEventListener('message', onMessage);
    moveButton.disabled = false;
    say('This browser would not let the old data be read. Nothing was deleted.');
    console.error(error);
  }
});

// Once this page has reached a controlled install, the duplicate offline app
// must not keep booting out of an old cache. This does not touch localStorage
// or IndexedDB, which are exactly what the move button reads.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) =>
      registration.unregister())))
    .catch(() => {});
}
if ('caches' in window) {
  caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('munin-'))
    .map((key) => caches.delete(key)))).catch(() => {});
}
