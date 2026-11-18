// Applies intraday prices (data/live.json, published every ~15 min in market hours) on top of
// the daily snapshot. Kept in memory only; the next daily snapshot contains the official close.
import { run, get, tx } from "./b-db.ts";
import { applyQuotes, applyRecent, type RecentFile } from "../../../shared/published.ts";

const DB = { run, get, tx };

interface LiveFile { generatedAt: string; asOf: string; quotes: (string | number | null)[][]; columns: string[]; news?: (string | number | null)[][]; newsColumns?: string[] }
let appliedAt = "", recentAt = "";
/** After a new market file is mounted, the latest intraday prices must be applied again on top of it. */
export function forgetLive() { appliedAt = ""; recentAt = ""; }

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
  if (!live.asOf || live.generatedAt === appliedAt) return newNews > 0;
  if (!applyQuotes(DB, "m.", live)) return newNews > 0;
  appliedAt = live.generatedAt;
  return true;
}

/** Fills in any trading days missing from the saved market data (recent.json, about 100 KB). True when days were added. */
export async function applyRecentDays(base: string): Promise<boolean> {
  let f: RecentFile;
  try {
    const r = await fetch(`${base}data/recent.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    f = await r.json();
  } catch { return false; }
  if (!f.generatedAt || f.generatedAt === recentAt) return false;
  let added = 0;
  try { added = applyRecent(DB, "m.", f); } catch (e) { console.warn("[recent]", e); return false; }
  recentAt = f.generatedAt;
  return added > 0;
}
