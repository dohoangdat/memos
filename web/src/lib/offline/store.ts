/**
 * A tiny key-value store in IndexedDB for offline use. Values are stored by structured clone,
 * so protobuf messages (with bigint timestamps) round-trip as they are. Every call fails soft:
 * without IndexedDB (private mode, tests) the app simply has no offline copy.
 */
const DB_NAME = "memos-offline";
const STORE = "kv";

let opening: Promise<IDBDatabase | null> | null = null;

const open = (): Promise<IDBDatabase | null> => {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
};

const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
};

export const offlineGet = <T>(key: string) => run<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
export const offlineSet = (key: string, value: unknown) => run("readwrite", (store) => store.put(value, key));
export const offlineDelete = (key: string) => run("readwrite", (store) => store.delete(key));
export const offlineClear = () => run("readwrite", (store) => store.clear());
