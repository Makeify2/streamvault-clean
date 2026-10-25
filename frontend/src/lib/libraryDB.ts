export interface LibraryItem {
  tmdbId: number;
  title: string;
  posterPath?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
  addedAt: number;
  lastPlayedAt?: number;
}

const DB_NAME = 'sv-local-library';
const DB_VERSION = 1;
const STORE = 'items';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'tmdbId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addLibraryItem(item: LibraryItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeLibraryItem(tmdbId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(tmdbId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getLibraryItems(): Promise<LibraryItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve((req.result as LibraryItem[]).sort((a, b) => b.addedAt - a.addedAt));
    req.onerror = () => reject(req.error);
  });
}

export async function updateLastPlayed(tmdbId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(tmdbId);
    req.onsuccess = () => {
      const item = req.result as LibraryItem | undefined;
      if (item) store.put({ ...item, lastPlayedAt: Date.now() });
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
