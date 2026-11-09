// SQLite via Node's built-in driver (no native build step). WAL mode, foreign keys on.
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const MIGRATIONS: string[] = [
  // 1: market data
  `
  CREATE TABLE companies (
    symbol TEXT PRIMARY KEY, name TEXT, sector TEXT, listed_shares REAL, paid_up_value REAL, total_paid_up REAL,
    operation_date TEXT, email TEXT, phone TEXT, address TEXT, website TEXT, registrar TEXT,
    ss_company_id INTEGER, status TEXT DEFAULT 'active', info_fetched_at TEXT, updated_at TEXT, source TEXT
  );
  CREATE TABLE prices (
    symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL,
    volume REAL, amount REAL, trades REAL, source TEXT, PRIMARY KEY (symbol, date)
  ) WITHOUT ROWID;
  CREATE INDEX prices_date ON prices(date);
  CREATE TABLE quotes (
    symbol TEXT PRIMARY KEY, date TEXT, open REAL, high REAL, low REAL, close REAL, ltp REAL, prev_close REAL,
    change REAL, change_pct REAL, vwap REAL, volume REAL, turnover REAL, trades REAL, high52 REAL, low52 REAL,
    fetched_at TEXT, source TEXT
  );
  CREATE TABLE indices (
    index_id INTEGER NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL,
    change REAL, change_pct REAL, turnover REAL, source TEXT, PRIMARY KEY (index_id, date)
  ) WITHOUT ROWID;
  CREATE TABLE dividends (
    symbol TEXT NOT NULL, fiscal_year TEXT NOT NULL, cash_pct REAL, bonus_pct REAL, total_pct REAL,
    announcement_date TEXT, bookclose_date TEXT, distribution_date TEXT, source TEXT, fetched_at TEXT,
    PRIMARY KEY (symbol, fiscal_year)
  );
  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, title TEXT NOT NULL, url TEXT UNIQUE, published_date TEXT,
    category TEXT, source TEXT, fetched_at TEXT
  );
  CREATE INDEX ann_symbol ON announcements(symbol, published_date);
  CREATE INDEX ann_date ON announcements(published_date);
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, period TEXT NOT NULL, fiscal_year TEXT NOT NULL,
    quarter INTEGER NOT NULL, source TEXT, fetched_at TEXT, UNIQUE(symbol, fiscal_year, quarter)
  );
  CREATE TABLE report_items (
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE, ord INTEGER, statement TEXT, label TEXT, value REAL
  );
  CREATE INDEX report_items_r ON report_items(report_id);
  CREATE TABLE forex (date TEXT, currency TEXT, unit INTEGER, buy REAL, sell REAL, PRIMARY KEY(date, currency));
  CREATE TABLE ingest_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, started_at TEXT, finished_at TEXT, status TEXT, rows INTEGER, message TEXT
  );
  CREATE TABLE data_freshness (
    dataset TEXT PRIMARY KEY, source TEXT, source_url TEXT, last_success_at TEXT, as_of TEXT, rows INTEGER,
    last_error TEXT, last_error_at TEXT
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `,
  // 2: users and personal data
  `
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT, expires_at TEXT, user_agent TEXT);
  CREATE TABLE login_attempts (ip TEXT, at TEXT);
  CREATE TABLE portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'real', strategy TEXT, notes TEXT, paper_cash REAL, created_at TEXT
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL,
    commission REAL, other_charges REAL, tax REAL, notes TEXT, created_at TEXT
  );
  CREATE INDEX tx_portfolio ON transactions(portfolio_id, date);
  CREATE TABLE watchlists (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT);
  CREATE TABLE watchlist_items (
    watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE, symbol TEXT NOT NULL, note TEXT,
    target_price REAL, stop_price REAL, added_at TEXT, PRIMARY KEY (watchlist_id, symbol)
  );
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT, type TEXT NOT NULL, params TEXT, note TEXT, active INTEGER DEFAULT 1, repeat INTEGER DEFAULT 0,
    last_triggered_at TEXT, last_checked_at TEXT, created_at TEXT
  );
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id INTEGER, kind TEXT, title TEXT, body TEXT, symbol TEXT, data_date TEXT, created_at TEXT, read INTEGER DEFAULT 0
  );
  CREATE TABLE vault (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, data_enc TEXT NOT NULL, created_at TEXT, updated_at TEXT
  );
  CREATE INDEX vault_kind ON vault(user_id, kind);
  `,
  // 3: products, resources, documents, AI
  `
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, provider TEXT, description TEXT,
    eligibility TEXT, min_investment TEXT, return_text TEXT, return_type TEXT, risk TEXT, lock_in TEXT, duration TEXT,
    liquidity TEXT, tax TEXT, conditions TEXT, how_to_apply TEXT, official_url TEXT, info_url TEXT,
    verified_on TEXT, source TEXT, user_edited INTEGER DEFAULT 0, seed_key TEXT UNIQUE
  );
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, name TEXT NOT NULL, description TEXT, url TEXT, links TEXT, seed_key TEXT UNIQUE
  );
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, symbol TEXT, title TEXT,
    kind TEXT, period TEXT, filename TEXT, pages INTEGER, source_url TEXT, uploaded_at TEXT
  );
  CREATE TABLE doc_pages (doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page INTEGER, text TEXT, PRIMARY KEY(doc_id, page));
  CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT, content TEXT, display TEXT, tools TEXT, created_at TEXT
  );
  `,
  // 4: public issues and mutual fund NAVs
  `
  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT, issue_type TEXT NOT NULL, symbol TEXT, company TEXT, ratio TEXT, units REAL, price REAL,
    price_low REAL, price_high REAL, cutoff REAL, opening_date TEXT, closing_date TEXT, final_date TEXT, listing_date TEXT,
    issue_manager TEXT, status INTEGER, share_type TEXT, ss_company_id INTEGER, fetched_at TEXT,
    UNIQUE(issue_type, ss_company_id, opening_date, units)
  );
  CREATE INDEX issues_symbol ON issues(symbol);
  CREATE TABLE fund_navs (
    symbol TEXT PRIMARY KEY, name TEXT, kind TEXT, fund_size REAL, maturity_date TEXT, maturity_period TEXT, daily_nav REAL, daily_date TEXT,
    weekly_nav REAL, weekly_date TEXT, monthly_nav REAL, monthly_date TEXT, ltp REAL, ltp_date TEXT, premium_pct REAL, fetched_at TEXT
  );
  CREATE TABLE fund_nav_history (symbol TEXT, date TEXT, nav REAL, basis TEXT, PRIMARY KEY(symbol, date, basis)) WITHOUT ROWID;
  `,
  // 5: official NRB rates and macro reports; your own verified deposit rates
  `
  CREATE TABLE rates (key TEXT PRIMARY KEY, grp TEXT, label TEXT, value REAL, as_of TEXT, prev_value REAL, prev_as_of TEXT, source_url TEXT, fetched_at TEXT);
  CREATE TABLE rate_history (key TEXT, as_of TEXT, value REAL, PRIMARY KEY(key, as_of)) WITHOUT ROWID;
  CREATE TABLE macro_reports (url TEXT PRIMARY KEY, pdf_url TEXT, title TEXT, published TEXT, inflation REAL, highlights TEXT, fetched_at TEXT);
  CREATE TABLE deposit_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, institution TEXT NOT NULL, inst_type TEXT, product TEXT, depositor TEXT DEFAULT 'individual',
    tenor_months INTEGER, rate REAL NOT NULL, effective_from TEXT, source_url TEXT, method TEXT DEFAULT 'manual', verified_on TEXT, notes TEXT, created_at TEXT
  );
  `,
  // 6: official interest-rate notices of banks and finance companies (links to the notice images)
  `
  CREATE TABLE rate_notices (url TEXT PRIMARY KEY, symbol TEXT, institution TEXT, inst_type TEXT, title TEXT, published TEXT, image_url TEXT, effective TEXT, fetched_at TEXT);
  CREATE INDEX rate_notices_symbol ON rate_notices(symbol, published);
  `,
  // 7: official corporate events per company (AGM, auditor, reports); refresh all company details once to fill them and websites
  `
  CREATE TABLE company_events (url TEXT PRIMARY KEY, symbol TEXT NOT NULL, title TEXT, published_date TEXT, kind TEXT, fetched_at TEXT);
  CREATE INDEX company_events_symbol ON company_events(symbol, published_date);
  UPDATE companies SET info_fetched_at = NULL;
  `,
  // 8: income and expense tracker (personal)
  `
  CREATE TABLE money_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, note TEXT, method TEXT, created_at TEXT);
  CREATE INDEX money_entries_date ON money_entries(date);
  `,
  // 9: market-wide computations shipped in the snapshot so phones don't recompute them
  `
  CREATE TABLE computed (name TEXT PRIMARY KEY, stamp TEXT, json TEXT, created_at TEXT);
  `,
  // 10: audited financial statements per company (official notice images / NEPSE PDFs)
  `
  CREATE TABLE audit_docs (url TEXT PRIMARY KEY, symbol TEXT NOT NULL, fiscal_year TEXT, title TEXT, published TEXT, images TEXT, pdfs TEXT, fetched_at TEXT);
  CREATE INDEX audit_docs_symbol ON audit_docs(symbol, published);
  `,
  // 11: forward log of each day's BUY/SELL signals (judged later against real prices)
  `
  CREATE TABLE signal_log (date TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, setup TEXT, entry_low REAL, entry_high REAL, stop REAL, t1 REAL, t2 REAL, price REAL, PRIMARY KEY (date, symbol));
  `,
];

db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
const applied = new Set((db.prepare("SELECT version FROM _migrations").all() as { version: number }[]).map((r) => r.version));
MIGRATIONS.forEach((sql, i) => {
  const v = i + 1;
  if (applied.has(v)) return;
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(v, new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
});

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const all = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[];
export const get = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as never[])) as T | undefined;
export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));

export function getSetting<T>(key: string, fallback: T): T {
  const r = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}
export function setSetting(key: string, value: unknown) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}

export const nowIso = () => new Date().toISOString();
