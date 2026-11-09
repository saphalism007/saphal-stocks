// Encrypted sync of your personal data between devices, stored in a secret GitHub Gist on
// your own account. The database is gzip-compressed and encrypted on the device with
// AES-256-GCM using a key derived from your passphrase (PBKDF2-SHA256, 310,000 rounds).
// GitHub only ever stores ciphertext. The token and passphrase stay on each device.
import { api } from "./api.ts";
import { onBackendEvent } from "./backend.ts";

const GIST_DESC = "Saphal Stocks encrypted sync (do not edit)";
const FILE = "saphal-stocks-sync.json";
const LS = { token: "ss-sync-token", pass: "ss-sync-pass", gist: "ss-sync-gist", last: "ss-sync-last", changed: "ss-sync-changed", device: "ss-device-id", auto: "ss-sync-auto", lastResult: "ss-sync-result" };

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

export function deviceId() {
  let id = ls.get(LS.device);
  if (!id) { id = crypto.randomUUID(); ls.set(LS.device, id); }
  return id;
}
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  return "Browser";
}

export interface SyncStatus { connected: boolean; auto: boolean; lastSyncAt: string | null; lastResult: string | null; localChanged: boolean; gistId: string | null }
export function syncStatus(): SyncStatus {
  const last = ls.get(LS.last);
  return { connected: !!(ls.get(LS.token) && ls.get(LS.pass) && ls.get(LS.gist)), auto: ls.get(LS.auto) !== "0", lastSyncAt: last ? JSON.parse(last).at : null, lastResult: ls.get(LS.lastResult), localChanged: ls.get(LS.changed) === "1", gistId: ls.get(LS.gist) };
}

// Mark local changes whenever the backend saves personal data.
let suppressChange = false;
onBackendEvent((e) => { if (e.type === "saved" && (e as { user?: boolean }).user && !suppressChange) { ls.set(LS.changed, "1"); scheduleAutoSync(); } });

// ---------- crypto ----------
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function gzip(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
async function gunzip(u: Uint8Array) { return new Uint8Array(await new Response(new Blob([u as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }

async function seal(db: Uint8Array, pass: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(pass, salt), await gzip(db)));
  return { v: 1, alg: "PBKDF2-SHA256-310000/AES-256-GCM/gzip", salt: b64(salt), iv: b64(iv), data: b64(ct) };
}
async function open(env: { salt: string; iv: string; data: string }, pass: string) {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) as BufferSource }, await keyFrom(pass, unb64(env.salt)), unb64(env.data) as BufferSource);
    return await gunzip(new Uint8Array(plain));
  } catch { throw new Error("Could not decrypt the synced data. Check that the passphrase is the same on all your devices."); }
}

// ---------- GitHub Gist ----------
async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  if (r.status === 401) throw new Error("GitHub rejected the token. Create a new one with the “gist” permission.");
  if (r.status === 403 || r.status === 404) throw new Error(`GitHub refused access (${r.status}). The token needs the “gist” permission.`);
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
  return (await r.json()) as T;
}
interface Gist { id: string; description: string; updated_at: string; files: Record<string, { content?: string; truncated?: boolean; raw_url: string }> }
interface Envelope { v: number; alg: string; salt: string; iv: string; data: string; updatedAt: string; device: string; deviceName: string; app: string }

async function readRemote(token: string, gistId: string): Promise<Envelope | null> {
  const g = await gh<Gist>(`/gists/${gistId}`, token);
  const f = g.files[FILE];
  if (!f) return null;
  const text = f.truncated || !f.content ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(text) as Envelope;
}

async function writeRemote(token: string, gistId: string | null, env: Envelope): Promise<string> {
  const body = JSON.stringify({ description: GIST_DESC, public: false, files: { [FILE]: { content: JSON.stringify(env) } } });
  const g = gistId ? await gh<Gist>(`/gists/${gistId}`, token, { method: "PATCH", body }) : await gh<Gist>("/gists", token, { method: "POST", body });
  return g.id;
}

async function localDb() {
  const r = await api<{ base64: string }>("/backup/file");
  return unb64(r.base64);
}
async function restoreLocal(db: Uint8Array) {
  suppressChange = true;
  try { await api("/backup/restore", { body: { base64: b64(db) } }); } finally { setTimeout(() => (suppressChange = false), 3000); }
}

async function push(token: string, pass: string, gistId: string | null) {
  const env: Envelope = { ...(await seal(await localDb(), pass)), updatedAt: new Date().toISOString(), device: deviceId(), deviceName: deviceName(), app: "saphal-stocks" };
  const id = await writeRemote(token, gistId, env);
  ls.set(LS.gist, id);
  ls.set(LS.last, JSON.stringify({ at: env.updatedAt, remote: env.updatedAt }));
  ls.del(LS.changed);
  return env;
}

/** Connects this device. If sync data already exists on GitHub it is used (after checking the passphrase). */
export async function connect(token: string, pass: string): Promise<{ result: "created" | "joined"; remote?: Envelope }> {
  if (pass.length < 10) throw new Error("Use a passphrase of at least 10 characters (the same on every device).");
  const user = await gh<{ login: string }>("/user", token).catch(() => null);
  void user;
  const gists = await gh<Gist[]>("/gists?per_page=100", token);
  const existing = gists.find((g) => g.description === GIST_DESC && g.files[FILE]);
  ls.set(LS.token, token); ls.set(LS.pass, pass);
  if (existing) {
    ls.set(LS.gist, existing.id);
    const remote = await readRemote(token, existing.id);
    if (remote) { await open(remote, pass); return { result: "joined", remote }; } // verifies passphrase
  }
  await push(token, pass, existing?.id ?? null);
  return { result: "created" };
}

export function disconnect() { for (const k of [LS.token, LS.pass, LS.gist, LS.last, LS.changed, LS.lastResult]) ls.del(k); }
export function setAuto(on: boolean) { ls.set(LS.auto, on ? "1" : "0"); }

export type SyncOutcome = { action: "pushed" | "pulled" | "up-to-date" | "conflict"; remote?: Envelope; message: string };

/** Two-way sync: uploads if only this device changed, downloads if only another device changed. */
export async function syncNow(resolve?: "keep-local" | "use-remote"): Promise<SyncOutcome> {
  const token = ls.get(LS.token), pass = ls.get(LS.pass), gistId = ls.get(LS.gist);
  if (!token || !pass || !gistId) throw new Error("Sync is not set up on this device.");
  const remote = await readRemote(token, gistId);
  const last = JSON.parse(ls.get(LS.last) || "{}") as { remote?: string };
  const localChanged = ls.get(LS.changed) === "1";
  const remoteChanged = !!remote && remote.updatedAt !== last.remote;
  let out: SyncOutcome;
  if (!remote || resolve === "keep-local" || (localChanged && !remoteChanged)) {
    await push(token, pass, gistId);
    out = { action: "pushed", message: "Your changes were uploaded (encrypted)." };
  } else if (resolve === "use-remote" || (remoteChanged && !localChanged)) {
    await restoreLocal(await open(remote, pass));
    ls.set(LS.last, JSON.stringify({ at: new Date().toISOString(), remote: remote.updatedAt }));
    ls.del(LS.changed);
    out = { action: "pulled", remote, message: `Updated with changes from your ${remote.deviceName} (${new Date(remote.updatedAt).toLocaleString()}).` };
  } else if (remoteChanged && localChanged) {
    out = { action: "conflict", remote, message: `Both this device and your ${remote.deviceName} have changes since the last sync.` };
  } else {
    ls.set(LS.last, JSON.stringify({ at: new Date().toISOString(), remote: remote.updatedAt }));
    out = { action: "up-to-date", message: "Everything is up to date." };
  }
  ls.set(LS.lastResult, out.message);
  return out;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let onPulled: (() => void) | null = null;
export function onSyncPulled(fn: () => void) { onPulled = fn; }
export function scheduleAutoSync(delay = 20_000) {
  const s = syncStatus();
  if (!s.connected || !s.auto) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try { const r = await syncNow(); if (r.action === "pulled") onPulled?.(); } catch (e) { ls.set(LS.lastResult, `Sync failed: ${e instanceof Error ? e.message : e}`); }
  }, delay);
}
