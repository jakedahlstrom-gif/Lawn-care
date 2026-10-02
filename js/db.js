// Thin promise wrapper around IndexedDB. Everything lives on the device.

const DB_NAME = 'lawncare';
const DB_VERSION = 1;
export const STORES = ['kv', 'zones', 'products', 'logs', 'photos'];

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, name === 'kv' ? undefined : { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked by another open tab.'));
    });
  }
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

/**
 * Run several writes atomically. `fn` receives a store accessor and must only
 * queue requests (no awaits inside).
 */
export async function tx(stores, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    try {
      result = fn((name) => t.objectStore(name));
    } catch (err) {
      t.abort();
      reject(err);
    }
  });
}

export const put = (store, value, key) => tx([store], (s) => {
  if (key === undefined) s(store).put(value);
  else s(store).put(value, key);
});

export const del = (store, key) => tx([store], (s) => { s(store).delete(key); });

export const clearAll = () => tx(STORES, (s) => { STORES.forEach((n) => s(n).clear()); });
