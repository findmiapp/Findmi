// A small, faithful in-memory IndexedDB — just the surface
// lib/guest-moment-media-db.ts uses (open/upgrade, transaction,
// objectStore put/get/delete, request + transaction callbacks). The DB
// lives at module level, so it survives a component unmount/remount
// exactly like a real browser's IndexedDB survives a reload. Values are
// kept by reference, so Blob/File bytes round-trip untouched.
const dbs = new Map();

export function resetFakeIndexedDb() {
  dbs.clear();
}
export function fakeIndexedDbSnapshot() {
  return Object.fromEntries([...dbs].map(([name, db]) => [name, { version: db.version, stores: Object.fromEntries([...db.stores].map(([s, m]) => [s, [...m.keys()]])) }]));
}

const later = (fn) => setTimeout(fn, 0);

export function installFakeIndexedDb() {
  globalThis.indexedDB = {
    open(name, version) {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (!db) {
          db = { version, stores: new Map() };
          dbs.set(name, db);
        }
        const handle = {
          objectStoreNames: { contains: (s) => db.stores.has(s) },
          createObjectStore: (s) => db.stores.set(s, new Map()),
          transaction(storeName) {
            const tx = { oncomplete: null, onerror: null };
            tx.objectStore = () => {
              const store = db.stores.get(storeName);
              return {
                put(value, key) {
                  store.set(key, value);
                  later(() => tx.oncomplete?.());
                },
                delete(key) {
                  store.delete(key);
                  later(() => tx.oncomplete?.());
                },
                get(key) {
                  const r = { result: undefined, onsuccess: null, onerror: null };
                  later(() => {
                    r.result = store.get(key);
                    r.onsuccess?.();
                  });
                  return r;
                },
              };
            };
            return tx;
          },
        };
        req.result = handle;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}
