// The app's backend, running in a Web Worker on your device. It hosts the same route code as
// the desktop server, on top of SQLite compiled to WebAssembly.
import "./b-process.ts";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { ZodError } from "zod";
import { useDatabase, USER_SCHEMA, mergeReferenceData, ensureStarterData, onDirty, takeDirty, bookkeeping } from "./b-db.ts";
import { Router, makeResponse, type Request, type UploadedFile } from "./b-express.ts";
import { authRouter, requireAuth } from "./b-auth.ts";
import { systemRouter } from "./b-system.ts";
import { hooks } from "./b-hooks.ts";
import { marketRouter } from "../../../server/routes/market.ts";
import { portfolioRouter } from "../../../server/routes/portfolio.ts";
import { aiRouter } from "../../../server/routes/ai.ts";
import { wealthRouter } from "../../../server/routes/wealth.ts";
import { evaluateAlerts } from "../../../server/lib/alerts.ts";
import { idbGet, idbSet, idbDel } from "./idb.ts";
import { applyLive } from "./live.ts";

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
let marketDb: Database | null = null; // the snapshot, opened by sql.js inside its virtual filesystem

let SQL: SqlJsStatic;
let main: Database;
let market: { version: string | null; asOf: string | null; generatedAt: string | null; bytes: number; source: "network" | "device" | "none" } = { version: null, asOf: null, generatedAt: null, bytes: 0, source: "none" };

function attach() {
  main.exec("PRAGMA foreign_keys = ON");
  const file = (marketDb as unknown as { filename?: string } | null)?.filename;
  if (file) { try { main.exec(`ATTACH DATABASE '${file}' AS m`); } catch (e) { if (!/already in use/.test(String(e))) throw e; } }
  useDatabase(main);
}

// ---------- persistence of personal data ----------
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUser = false;
async function persist() {
  const d = takeDirty();
  pendingUser = pendingUser || d.user;
  if (!d.dirty) return;
  const bytes = main.export(); // sql.js closes and reopens the database here...
  attach(); // ...so re-attach the market snapshot and reset cached statements.
  await idbSet("user-db", bytes);
  post({ type: "saved", at: new Date().toISOString(), user: pendingUser });
  pendingUser = false;
}
onDirty(() => { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => void persist(), 1200); });

// ---------- market snapshot ----------
async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new Uint8Array(buf); // already decompressed by the server
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

async function download(url: string, total: number): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    post({ type: "progress", message: `Downloading market data… ${total ? Math.round((got / total) * 100) : Math.round(got / 1e6)}${total ? "%" : " MB"}` });
  }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

async function fetchManifest() {
  try {
    const r = await fetch(`${BASE}data/manifest.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return r.ok ? (await r.json()) as { version: string; asOf: string; generatedAt: string; gzipBytes: number } : null;
  } catch { return null; }
}

const isSqlite = (b: Uint8Array | undefined) => !!b && b.length > 1000 && new TextDecoder().decode(b.subarray(0, 15)) === "SQLite format 3";

function mountMarket(bytes: Uint8Array) {
  try { main.exec("DETACH DATABASE m"); } catch { /* not attached yet */ }
  try { marketDb?.close(); } catch { /* ignore */ }
  marketDb = new SQL.Database(bytes);
  attach();
  mergeReferenceData();
}

async function loadMarket(force: boolean) {
  const cachedVer = await idbGet<string>("market-version");
  const manifest = await fetchManifest();
  void force;
  if (manifest && manifest.version !== cachedVer) {
    {
      const gz = await download(`${BASE}data/market.db.bin?v=${manifest.version}`, manifest.gzipBytes).catch((e) => { throw new Error(`Downloading market data failed: ${e instanceof Error ? e.message : e}`); });
      post({ type: "progress", message: "Preparing data…" });
      const bytes = await gunzip(gz);
      if (!isSqlite(bytes)) throw new Error("The downloaded market data is not valid. Try again in a few minutes.");
      await idbSet("market-db", bytes);
      await idbSet("market-version", manifest.version);
      await idbSet("market-meta", { asOf: manifest.asOf, generatedAt: manifest.generatedAt });
      mountMarket(bytes);
      market = { version: manifest.version, asOf: manifest.asOf, generatedAt: manifest.generatedAt, bytes: bytes.length, source: "network" };
      return true;
    }
  }
  if (market.version && market.version === cachedVer) return false; // already mounted
  let cached = await idbGet<Uint8Array>("market-db");
  if (cached && !isSqlite(cached)) {
    await idbDel("market-db"); await idbDel("market-version"); cached = undefined;
    if (manifest) return loadMarket(force); // re-download a clean copy
  }
  if (!cached) throw new Error(manifest ? "Could not download market data." : "No market data on this device yet and the data server can't be reached. Connect to the internet and reload.");
  const meta = (await idbGet<{ asOf: string; generatedAt: string }>("market-meta")) ?? { asOf: null, generatedAt: null };
  mountMarket(cached);
  market = { version: cachedVer ?? null, asOf: meta.asOf, generatedAt: meta.generatedAt, bytes: cached.length, source: "device" };
  return false;
}

hooks.checkForUpdate = async (force) => {
  const before = market.version;
  await loadMarket(force);
  const live = await applyLive(BASE);
  const updated = market.version !== before;
  if (updated || live) { const { resetMarketCaches } = await import("../../../server/lib/market.ts"); resetMarketCaches?.(); }
  if (updated || live) { try { bookkeeping(() => evaluateAlerts()); } catch (e) { console.warn(e); } }
  return { updated, version: market.version, asOf: market.asOf, message: updated ? `Loaded market data as of ${market.asOf}.` : live ? "Applied the latest intraday prices." : `Already up to date (data as of ${market.asOf}).` };
};
hooks.marketInfo = () => ({ ...market });
// Backups and sync never carry device secrets (the AI key stays on each device).
const DEVICE_ONLY_SETTINGS = ["aiKey"];
hooks.exportUserDb = () => {
  const b = main.export(); attach();
  const copy = new SQL.Database(b);
  copy.run(`DELETE FROM settings WHERE key IN (${DEVICE_ONLY_SETTINGS.map(() => "?").join(",")})`, DEVICE_ONLY_SETTINGS);
  const out = copy.export(); copy.close();
  return out;
};
hooks.importUserDb = async (bytes) => {
  const keep = main.exec(`SELECT key, value FROM main.settings WHERE key IN (${DEVICE_ONLY_SETTINGS.map((k) => `'${k}'`).join(",")})`)[0]?.values ?? [];
  main.close();
  main = new SQL.Database(bytes);
  main.exec(USER_SCHEMA);
  for (const [k, v] of keep) main.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [k as string, v as string]);
  attach();
  mergeReferenceData();
  await idbSet("user-db", main.export());
  attach();
};

// ---------- routing ----------
const app = Router();
app.use("/api/auth", authRouter);
app.use("/api", requireAuth, marketRouter, portfolioRouter, aiRouter, wealthRouter, systemRouter);

interface Msg { id: number; method: string; path: string; headers?: Record<string, string>; body?: unknown; files?: { fieldname: string; filename: string; type: string; buffer: ArrayBuffer }[] }

async function handle(m: Msg) {
  const url = new URL(m.path, "http://local");
  let started = false;
  const start = () => { if (!started) { started = true; post({ id: m.id, type: "start", status: res.statusCode, headers: res.headers }); } };
  const res = makeResponse((chunk) => { start(); post({ id: m.id, type: "chunk", data: chunk }); }, () => {
    if (!started) { started = true; post({ id: m.id, type: "start", status: res.statusCode, headers: res.headers }); }
    post({ id: m.id, type: "end", body: res.body });
  });
  const files: UploadedFile[] = (m.files || []).map((f) => ({ fieldname: f.fieldname, originalname: f.filename, mimetype: f.type, buffer: new Uint8Array(f.buffer), size: f.buffer.byteLength }));
  const headers = Object.fromEntries(Object.entries(m.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req: Request = {
    method: m.method.toUpperCase(), path: url.pathname, url: m.path, params: {}, query: Object.fromEntries(url.searchParams),
    body: m.body ?? {}, headers, cookies: {}, ip: "device", secure: true, files, get: (n) => headers[n.toLowerCase()],
  };
  try {
    const ok = await app.handle(req, res, url.pathname);
    if (!ok && !res.headersSent) res.status(404).json({ error: "Not found" });
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof ZodError) { res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }); return; }
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error("[backend]", err);
    res.status(status).json({ error: status >= 500 ? `Error: ${message}` : message });
  }
}

let ready: Promise<void>;
async function boot() {
  post({ type: "progress", message: "Starting…" });
  SQL = await initSqlJs({ locateFile: () => wasmUrl }).catch((e) => { throw new Error(`Could not start the database engine (${e instanceof Error ? e.message : e}).`); });
  const userBytes = await idbGet<Uint8Array>("user-db");
  main = new SQL.Database(userBytes ?? undefined);
  main.exec(USER_SCHEMA);
  useDatabase(main);
  await loadMarket(false);
  ensureStarterData();
  takeDirty(); // first-run starter data is not a change to sync
  await applyLive(BASE);
  try { bookkeeping(() => evaluateAlerts()); } catch (e) { console.warn("[alerts]", e); }
  await persist();
  post({ type: "ready", market });
  // While the app is open, look for new data every 5 minutes (intraday prices, next day's snapshot).
  setInterval(async () => {
    try { const r = await hooks.checkForUpdate(false); if (r.updated || /intraday/.test(r.message)) post({ type: "data-updated", message: r.message, market }); } catch { /* offline: try later */ }
  }, 5 * 60_000);
}
ready = boot().catch((e) => { post({ type: "fatal", message: e instanceof Error ? e.message : String(e) }); throw e; });

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as Msg & { type?: string };
  if (m.type === "flush") { await persist(); post({ type: "flushed" }); return; }
  try { await ready; } catch (err) { post({ id: m.id, type: "start", status: 503, headers: { "content-type": "application/json" } }); post({ id: m.id, type: "end", body: JSON.stringify({ error: String((err as Error).message || err) }) }); return; }
  await handle(m);
};
