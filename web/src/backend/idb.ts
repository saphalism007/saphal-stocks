// Tiny IndexedDB key-value store (works in workers, Safari included).
const DB_NAME = "saphal-stocks";
let dbp: Promise<IDBDatabase> | null = null;
function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
export async function idbGet<T>(key: string): Promise<T | undefined> {
  const d = await open();
  return new Promise((resolve, reject) => { const r = d.transaction("kv").objectStore("kv").get(key); r.onsuccess = () => resolve(r.result as T); r.onerror = () => reject(r.error); });
}
export async function idbSet(key: string, value: unknown): Promise<void> {
  const d = await open();
  return new Promise((resolve, reject) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(value, key); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
}
export async function idbDel(key: string): Promise<void> {
  const d = await open();
  return new Promise((resolve, reject) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").delete(key); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
}
