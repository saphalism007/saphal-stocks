// The small data files the cloud job publishes next to the big daily snapshot (market.db.bin):
//   live.json    the latest quotes (and recent news), refreshed every cloud run
//   recent.json  every price and index row of the last trading days
// Any copy of the app (iPhone, iPad, browser or the Mac version) applies them when it opens, so a missed day is
// filled in within seconds, even when the big snapshot is slow to download or the Mac was not running at the time.

export interface Db {
  run: (sql: string, ...a: unknown[]) => unknown;
  get: <T>(sql: string, ...a: unknown[]) => T | undefined;
  tx: <T>(fn: () => T) => T;
}
export interface RecentFile { generatedAt: string; asOf: string; dates: string[]; prices: { columns: string[]; rows: unknown[][] }; indices: { columns: string[]; rows: unknown[][] } }
export interface LiveFile { generatedAt: string; asOf: string; columns: string[]; quotes: (string | number | null)[][]; news?: (string | number | null)[][]; newsColumns?: string[] }

export const RECENT_DAYS = 20;
export const PRICE_COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "amount", "trades", "source"];
export const INDEX_COLS = ["index_id", "name", "date", "open", "high", "low", "close", "change", "change_pct", "turnover", "source"];

/** Builds recent.json from the full market database (used by the cloud job). */
export function buildRecent(all: <T>(sql: string, ...a: unknown[]) => T[], generatedAt: string): RecentFile {
  const dates = all<{ date: string }>(`SELECT DISTINCT date FROM prices ORDER BY date DESC LIMIT ${RECENT_DAYS}`).map((r) => r.date).sort();
  const from = dates[0] ?? "9999";
  const rows = (table: string, cols: string[]) => all<Record<string, unknown>>(`SELECT ${cols.join(", ")} FROM ${table} WHERE date >= ? ORDER BY date`, from).map((r) => cols.map((c) => r[c] ?? null));
  return { generatedAt, asOf: dates[dates.length - 1] ?? "", dates, prices: { columns: PRICE_COLS, rows: rows("prices", PRICE_COLS) }, indices: { columns: INDEX_COLS, rows: rows("indices", INDEX_COLS) } };
}

/** Raises a dataset's "as of" date (never lowers it). p is the table prefix: "m." in the browser app, "" on the Mac. */
function bump(db: Db, p: string, dataset: string, asOf: string, at: string) {
  const f = db.get<{ as_of: string | null }>(`SELECT as_of FROM ${p}data_freshness WHERE dataset = ?`, dataset);
  if (!f) { db.run(`INSERT INTO ${p}data_freshness (dataset, as_of, last_success_at) VALUES (?, ?, ?)`, dataset, asOf, at); return; }
  if (!f.as_of || f.as_of < asOf) db.run(`UPDATE ${p}data_freshness SET as_of = ?, last_success_at = ? WHERE dataset = ?`, asOf, at, dataset);
}

/** Adds every price and index row from recent.json that this database is missing or has older values for.
 *  Returns the number of trading days that were new to this database. */
export function applyRecent(db: Db, p: string, f: RecentFile): number {
  if (!f?.dates?.length || !f.prices?.rows) return 0;
  const have = new Set<string>();
  for (const d of f.dates) if (db.get(`SELECT 1 FROM ${p}prices WHERE date = ? LIMIT 1`, d)) have.add(d);
  const pi = (c: string) => f.prices.columns.indexOf(c), ii = (c: string) => f.indices.columns.indexOf(c);
  db.tx(() => {
    for (const r of f.prices.rows) {
      const v = (c: string) => r[pi(c)] ?? null;
      if (v("close") == null) continue;
      db.run(`INSERT INTO ${p}prices (symbol, date, open, high, low, close, volume, amount, trades, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, amount = excluded.amount, trades = excluded.trades, source = excluded.source`,
        v("symbol"), v("date"), v("open"), v("high"), v("low"), v("close"), v("volume"), v("amount"), v("trades"), v("source") ?? "published");
    }
    for (const r of f.indices?.rows ?? []) {
      const v = (c: string) => r[ii(c)] ?? null;
      if (v("close") == null) continue;
      db.run(`INSERT INTO ${p}indices (index_id, name, date, open, high, low, close, change, change_pct, turnover, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(index_id, date) DO UPDATE SET name = excluded.name, open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, change = excluded.change, change_pct = excluded.change_pct, turnover = excluded.turnover`,
        v("index_id"), v("name"), v("date"), v("open"), v("high"), v("low"), v("close"), v("change"), v("change_pct"), v("turnover"), v("source") ?? "published");
    }
    bump(db, p, "prices_history", f.asOf, f.generatedAt);
    bump(db, p, "indices", f.asOf, f.generatedAt);
  });
  return f.dates.filter((d) => !have.has(d)).length;
}

/** Applies the latest quotes from live.json when they are newer than what this database has. */
/** observedRange: the source page's day High/Low columns are not used (they were seen showing a high that no recorded
 *  trade confirms); the range is the open and the last price only. The relay instead sends the high and low of every
 *  price it recorded during the day. The official close data replaces either in the evening. */
export function applyQuotes(db: Db, p: string, live: LiveFile, opts: { observedRange?: boolean } = {}): boolean {
  if (!live?.asOf || !live.quotes?.length) return false;
  const snap = db.get<{ last_success_at: string; as_of: string }>(`SELECT last_success_at, as_of FROM ${p}data_freshness WHERE dataset = 'prices_latest'`);
  if (snap && (live.asOf < snap.as_of || (live.asOf === snap.as_of && live.generatedAt <= snap.last_success_at))) return false;
  const ix = (c: string) => live.columns.indexOf(c);
  db.tx(() => {
    for (const q of live.quotes) {
      const raw = (c: string) => (ix(c) >= 0 ? q[ix(c)] ?? null : null);
      const seenHi = opts.observedRange ? Math.max(Number(raw("open") ?? raw("ltp") ?? raw("close")), Number(raw("ltp") ?? raw("close"))) : null;
      const seenLo = opts.observedRange ? Math.min(Number(raw("open") ?? raw("ltp") ?? raw("close")), Number(raw("ltp") ?? raw("close"))) : null;
      const v = (c: string) => (opts.observedRange && c === "high" ? seenHi : opts.observedRange && c === "low" ? seenLo : raw(c));
      db.run(`INSERT INTO ${p}quotes (symbol, date, open, high, low, close, ltp, prev_close, change, change_pct, vwap, volume, turnover, trades, high52, low52, fetched_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live') ON CONFLICT(symbol) DO UPDATE SET date = excluded.date, open = excluded.open, high = excluded.high, low = excluded.low,
           close = excluded.close, ltp = excluded.ltp, prev_close = excluded.prev_close, change = excluded.change, change_pct = excluded.change_pct, vwap = excluded.vwap, volume = excluded.volume,
           turnover = excluded.turnover, trades = excluded.trades, high52 = COALESCE(excluded.high52, quotes.high52), low52 = COALESCE(excluded.low52, quotes.low52), fetched_at = excluded.fetched_at, source = 'live'`,
        v("symbol"), live.asOf, v("open"), v("high"), v("low"), v("close"), v("ltp"), v("prev_close"), v("change"), v("change_pct"), v("vwap"), v("volume"), v("turnover"), v("trades"), v("high52"), v("low52"), live.generatedAt);
      if (Number(v("volume")) > 0 && v("close") != null) {
        db.run(`INSERT INTO ${p}prices (symbol, date, open, high, low, close, volume, amount, trades, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')
             ON CONFLICT(symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, amount = excluded.amount, trades = excluded.trades
             WHERE prices.source = 'live'`, // never overwrite the official closing data
          v("symbol"), live.asOf, v("open") ?? v("close"), v("high") ?? v("close"), v("low") ?? v("close"), v("close"), v("volume"), v("turnover"), v("trades"));
      }
    }
    if (snap) db.run(`UPDATE ${p}data_freshness SET last_success_at = ?, as_of = ? WHERE dataset = 'prices_latest'`, live.generatedAt, live.asOf);
    else db.run(`INSERT INTO ${p}data_freshness (dataset, as_of, last_success_at) VALUES ('prices_latest', ?, ?)`, live.asOf, live.generatedAt);
  });
  return true;
}

/** Today's index values during the session (from the live-trading page). A day's official index data replaces them. */
export function applyLiveIndices(db: Db, p: string, asOf: string, indices: { id: number | null; name: string; value: number; changePct: number | null; turnover: number | null }[]): number {
  let n = 0;
  db.tx(() => {
    for (const x of indices) {
      if (x.id == null) continue;
      const prev = db.get<{ close: number }>(`SELECT close FROM ${p}indices WHERE index_id = ? AND date < ? ORDER BY date DESC LIMIT 1`, x.id, asOf);
      const change = prev ? Math.round((x.value - prev.close) * 100) / 100 : null;
      db.run(`INSERT INTO ${p}indices (index_id, name, date, open, high, low, close, change, change_pct, turnover, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')
              ON CONFLICT(index_id, date) DO UPDATE SET high = MAX(indices.high, excluded.close), low = MIN(indices.low, excluded.close), close = excluded.close,
              change = excluded.change, change_pct = excluded.change_pct, turnover = COALESCE(excluded.turnover, indices.turnover) WHERE indices.source = 'live'`,
        x.id, x.name, asOf, prev?.close ?? x.value, Math.max(x.value, prev?.close ?? x.value), Math.min(x.value, prev?.close ?? x.value), x.value, change, x.changePct, x.turnover);
      n++;
    }
  });
  return n;
}

/** The relay's file (relay/): live quotes plus today's index values. */
export interface RelayFile { fetchedAt: string; asOf: string; time: string; marketOpen: boolean | null; quotes: LiveFile; indices: { id: number | null; name: string; value: number; changePct: number | null; turnover: number | null }[] }
