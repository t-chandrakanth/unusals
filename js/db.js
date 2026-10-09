// Saves the whole app state on this device (IndexedDB, with localStorage as
// a fallback for browsers that block it).

const DB = 'loco-tracker';
const STORE = 'kv';
const KEY = 'state';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

export async function loadState() {
  try {
    const v = await tx('readonly', (s) => s.get(KEY));
    if (v) return v;
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(DB);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveState(state) {
  try {
    await tx('readwrite', (s) => s.put(state, KEY));
    return true;
  } catch { /* fall through */ }
  try {
    localStorage.setItem(DB, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
