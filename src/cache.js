const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

function createMemoryBackend() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async del(key) {
      store.delete(key);
    },
    async keys() {
      return [...store.keys()];
    },
    async clear() {
      store.clear();
    },
  };
}

function createIdbBackend(dbName = 'tvtime-cache', storeName = 'entries') {
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const withStore = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = fn(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async get(key) {
      const request = await withStore('readonly', (store) => store.get(key));
      return request?.value ?? null;
    },
    async set(key, value) {
      await withStore('readwrite', (store) => store.put(value, key));
    },
    async del(key) {
      await withStore('readwrite', (store) => store.delete(key));
    },
    async keys() {
      const request = await withStore('readonly', (store) => store.getAllKeys());
      return request ?? [];
    },
    async clear() {
      await withStore('readwrite', (store) => store.clear());
    },
  };
}

export function createCache({ backend, ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const store = backend || (typeof indexedDB !== 'undefined' ? createIdbBackend() : createMemoryBackend());
  let seq = 0;
  const stamp = () => {
    seq += 1;
    return { ms: Date.now(), seq };
  };
  const order = (a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.seq - b.seq);

  async function get(key) {
    const row = await store.get(key);
    if (!row) return null;
    if (Date.now() - row.touchedAt.ms > ttlMs) {
      await store.del(key);
      return null;
    }
    row.touchedAt = stamp();
    await store.set(key, row);
    return row.value;
  }

  async function set(key, value) {
    await store.set(key, { value, touchedAt: stamp() });
    const keys = await store.keys();
    if (keys.length > maxEntries) {
      const rows = [];
      for (const k of keys) {
        const row = await store.get(k);
        if (row) rows.push({ key: k, touchedAt: row.touchedAt });
      }
      rows.sort((a, b) => order(a.touchedAt, b.touchedAt));
      for (const row of rows.slice(0, rows.length - maxEntries)) {
        await store.del(row.key);
      }
    }
  }

  async function del(key) {
    await store.del(key);
  }

  async function clear() {
    await store.clear();
  }

  return { get, set, del, clear, _backend: store };
}

export { createMemoryBackend, createIdbBackend };
