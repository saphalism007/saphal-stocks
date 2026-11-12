// Applies intraday prices (data/live.json, published every ~15 min in market hours) on top of
// the daily snapshot. Kept in memory only; the next daily snapshot contains the official close.
import { run, get, tx } from "./b-db.ts";

interface LiveFile { generatedAt: string; asOf: string; quotes: (string | number | null)[][]; columns: string[]; news?: (string | number | null)[][]; newsColumns?: string[] }
let appliedAt = "";

export async function applyLive(base: string): Promise<boolean> {
  let live: LiveFile;
  try {
    const r = await fetch(`${base}data/live.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    live = await r.json();
  } catch { return false; }
  // News first: it can arrive before the open, when prices have not changed yet.
  let newNews = 0;
  if (live.news?.length && live.newsColumns) {
    const nc = live.newsColumns, ni = (c: string) => nc.indexOf(c);
    const before = get<{ n: number }>("SELECT COUNT(*) n FROM m.announcements")?.n ?? 0;
    try {
      tx(() => { for (const r of live.news!) { const v = (c: string) => (ni(c) >= 0 ? r[ni(c)] : null); if (!v("url") || !v("title")) continue; run("INSERT INTO m.announcements (symbol, title, url, published_date, category, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING", v("symbol"), v("title"), v("url"), v("published_date"), v("category"), v("source"), v("fetched_at")); } });
      newNews = (get<{ n: number }>("SELECT COUNT(*) n FROM m.announcements")?.n ?? 0) - before;
    } catch (e) { console.warn("[live news]", e); }
  }
  const snap = get<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM m.data_freshness WHERE dataset = 'prices_latest'");
  if (!live.asOf || live.generatedAt === appliedAt) return newNews > 0;
  if (snap && (live.asOf < snap.as_of || (live.asOf === snap.as_of && live.generatedAt <= snap.last_success_at))) return newNews > 0;
  const ix = (c: string) => live.columns.indexOf(c);
  tx(() => {
    for (const q of live.quotes) {
      const v = (c: string) => q[ix(c)];
      run(`INSERT INTO m.quotes (symbol, date, open, high, low, close, ltp, prev_close, change, change_pct, vwap, volume, turnover, trades, high52, low52, fetched_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live') ON CONFLICT(symbol) DO UPDATE SET date = excluded.date, open = excluded.open, high = excluded.high, low = excluded.low,
           close = excluded.close, ltp = excluded.ltp, prev_close = excluded.prev_close, change = excluded.change, change_pct = excluded.change_pct, vwap = excluded.vwap, volume = excluded.volume,
           turnover = excluded.turnover, trades = excluded.trades, high52 = excluded.high52, low52 = excluded.low52, fetched_at = excluded.fetched_at, source = 'live'`,
        v("symbol"), live.asOf, v("open"), v("high"), v("low"), v("close"), v("ltp"), v("prev_close"), v("change"), v("change_pct"), v("vwap"), v("volume"), v("turnover"), v("trades"), v("high52"), v("low52"), live.generatedAt);
      if (Number(v("volume")) > 0 && v("close") != null) {
        run(`INSERT INTO m.prices (symbol, date, open, high, low, close, volume, amount, trades, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')
             ON CONFLICT(symbol, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume, amount = excluded.amount, trades = excluded.trades`,
          v("symbol"), live.asOf, v("open") ?? v("close"), v("high") ?? v("close"), v("low") ?? v("close"), v("close"), v("volume"), v("turnover"), v("trades"));
      }
    }
    run("UPDATE m.data_freshness SET last_success_at = ?, as_of = ? WHERE dataset = 'prices_latest'", live.generatedAt, live.asOf);
  });
  appliedAt = live.generatedAt;
  return true;
}
