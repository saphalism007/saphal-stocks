// Browser replacement for server/db.ts. Two SQLite databases (sql.js / WebAssembly):
//   main   = your personal data (portfolios, journal, goals, settings...), saved on this device
//   market = the public market snapshot, ATTACHed as "m"; unqualified table names resolve to
//            main first, then market, so the server code's SQL runs unchanged.
import type { Database, SqlValue, Statement } from "sql.js";

let sql: Database | null = null;
let dirty = false;
let userDirty = false; // a change you made (vs. background bookkeeping), used by sync
const cache = new Map<string, Statement>();
const onWrite: (() => void)[] = [];

export function useDatabase(d: Database) { sql = d; cache.forEach((s) => { try { s.free(); } catch { /* ignore */ } }); cache.clear(); }
export function onDirty(fn: () => void) { onWrite.push(fn); }
export function takeDirty() { const d = { dirty, user: userDirty }; dirty = false; userDirty = false; return d; }
// Background writes that should not count as "you changed something" for sync.
const BOOKKEEPING = [/^\s*UPDATE alerts SET last_checked_at/i, /^\s*INSERT INTO notifications/i, /^\s*UPDATE alerts SET last_triggered_at/i];
let bookkeepingKey: string | null = null;
export function bookkeeping<T>(fn: () => T): T { const prev = bookkeepingKey; bookkeepingKey = "on"; try { return fn(); } finally { bookkeepingKey = prev; } }
export function rawDb() { if (!sql) throw new Error("Database not ready"); return sql; }

const norm = (p: unknown): SqlValue => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : (p as SqlValue));
const isWrite = (q: string) => !/^\s*(SELECT|WITH|PRAGMA\s+\w+\s*$|EXPLAIN)/i.test(q);
function markDirty(q: string) {
  if (!isWrite(q)) return;
  // Writes that only touch the attached market snapshot (live price updates) are not personal data.
  if (/\bm\.\w+/.test(q) && !/\bmain\./.test(q)) return;
  dirty = true;
  if (!bookkeepingKey && !BOOKKEEPING.some((r) => r.test(q))) userDirty = true;
  for (const f of onWrite) f();
}

function stmt(q: string): Statement {
  let s = cache.get(q);
  if (!s) { s = rawDb().prepare(q); cache.set(q, s); }
  return s;
}

function runAll<T>(q: string, params: unknown[]): T[] {
  const s = stmt(q);
  try {
    s.bind(params.map(norm));
    const rows: T[] = [];
    while (s.step()) rows.push(s.getAsObject() as T);
    return rows;
  } finally { s.reset(); }
}

export const db = {
  prepare(q: string) {
    return {
      all: (...p: unknown[]) => runAll(q, p),
      get: (...p: unknown[]) => runAll(q, p)[0],
      run: (...p: unknown[]) => {
        const s = stmt(q);
        try { s.bind(p.map(norm)); while (s.step()) { /* consume */ } } finally { s.reset(); }
        markDirty(q);
        const r = rawDb().exec("SELECT last_insert_rowid() id, changes() n")[0]?.values[0] ?? [0, 0];
        return { lastInsertRowid: Number(r[0]), changes: Number(r[1]) };
      },
    };
  },
  exec(q: string) { rawDb().exec(q); markDirty(q); },
};

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  rawDb().exec("BEGIN");
  try { const r = fn(); rawDb().exec("COMMIT"); return r; } catch (e) { try { rawDb().exec("ROLLBACK"); } catch { /* ignore */ } throw e; } finally { txDepth--; }
}

export const all = <T = Record<string, unknown>>(q: string, ...params: unknown[]) => db.prepare(q).all(...params) as T[];
export const get = <T = Record<string, unknown>>(q: string, ...params: unknown[]) => db.prepare(q).get(...params) as T | undefined;
export const run = (q: string, ...params: unknown[]) => db.prepare(q).run(...params);

export function getSetting<T>(key: string, fallback: T): T {
  const r = get<{ value: string }>("SELECT value FROM main.settings WHERE key = ?", key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: unknown) {
  run("INSERT INTO main.settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}
export const nowIso = () => new Date().toISOString();

/** Personal tables (same columns as the server schema) plus copies of products/resources so your edits persist. */
export const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT, expires_at TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS portfolios (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'real', strategy TEXT, notes TEXT, paper_cash REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE, symbol TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, commission REAL, other_charges REAL, tax REAL, notes TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS tx_portfolio ON transactions(portfolio_id, date);
CREATE TABLE IF NOT EXISTS watchlists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS watchlist_items (watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE, symbol TEXT NOT NULL, note TEXT, target_price REAL, stop_price REAL, added_at TEXT, PRIMARY KEY (watchlist_id, symbol));
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT, type TEXT NOT NULL, params TEXT, note TEXT, active INTEGER DEFAULT 1, repeat INTEGER DEFAULT 0, last_triggered_at TEXT, last_checked_at TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, alert_id INTEGER, kind TEXT, title TEXT, body TEXT, symbol TEXT, data_date TEXT, created_at TEXT, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data_enc TEXT NOT NULL, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, symbol TEXT, title TEXT, kind TEXT, period TEXT, filename TEXT, pages INTEGER, source_url TEXT, uploaded_at TEXT);
CREATE TABLE IF NOT EXISTS doc_pages (doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page INTEGER, text TEXT, PRIMARY KEY(doc_id, page));
CREATE TABLE IF NOT EXISTS ai_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS ai_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, role TEXT, content TEXT, display TEXT, tools TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, provider TEXT, description TEXT, eligibility TEXT, min_investment TEXT, return_text TEXT, return_type TEXT, risk TEXT, lock_in TEXT, duration TEXT, liquidity TEXT, tax TEXT, conditions TEXT, how_to_apply TEXT, official_url TEXT, info_url TEXT, verified_on TEXT, source TEXT, user_edited INTEGER DEFAULT 0, seed_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, name TEXT NOT NULL, description TEXT, url TEXT, links TEXT, seed_key TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS deposit_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, institution TEXT NOT NULL, inst_type TEXT, product TEXT, depositor TEXT DEFAULT 'individual', tenor_months INTEGER, rate REAL NOT NULL, effective_from TEXT, source_url TEXT, method TEXT DEFAULT 'manual', verified_on TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS money_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, note TEXT, method TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS money_entries_date ON money_entries(date);
INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (1, 'me', '-', datetime('now'));
`;

const PRODUCT_COLS = "category, name, provider, description, eligibility, min_investment, return_text, return_type, risk, lock_in, duration, liquidity, tax, conditions, how_to_apply, official_url, info_url, verified_on, source, user_edited, seed_key";

/** After a new market snapshot is attached: refresh curated products/resources, keeping your own edits. */
export function mergeReferenceData() {
  tx(() => {
    rawDb().exec(`DELETE FROM main.products WHERE user_edited = 0 AND seed_key IS NOT NULL;
      INSERT OR IGNORE INTO main.products (${PRODUCT_COLS}) SELECT ${PRODUCT_COLS} FROM m.products;
      DELETE FROM main.resources; INSERT INTO main.resources (category, name, description, url, links, seed_key) SELECT category, name, description, url, links, seed_key FROM m.resources;`);
  });
}

/** First-run starter structures, mirroring account setup on the server. */
export function ensureStarterData() {
  if (!get("SELECT 1 FROM main.watchlists LIMIT 1")) run("INSERT INTO main.watchlists (user_id, name, created_at) VALUES (1, 'My watchlist', ?)", nowIso());
  if (!get("SELECT 1 FROM main.portfolios LIMIT 1")) {
    run("INSERT INTO main.portfolios (user_id, name, kind, strategy, created_at) VALUES (1, 'Long-term investments', 'real', 'Long-term', ?)", nowIso());
    run("INSERT INTO main.portfolios (user_id, name, kind, strategy, paper_cash, created_at) VALUES (1, 'Paper trading', 'paper', 'Swing trading', 1000000, ?)", nowIso());
  }
}
