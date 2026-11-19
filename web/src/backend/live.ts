// Applies intraday prices (data/live.json, published every ~15 min in market hours) on top of
// the daily snapshot. Kept in memory only; the next daily snapshot contains the official close.
import { run, get, tx } from "./b-db.ts";
import { applyQuotes, applyRecent, applyLiveIndices, type RecentFile, type RelayFile } from "../../../shared/published.ts";
import { RELAY_URL } from "../../../shared/liveTrading.ts";

const DB = { run, get, tx };

interface LiveFile { generatedAt: string; asOf: string; quotes: (string | number | null)[][]; columns: string[]; news?: (string | number | null)[][]; newsColumns?: string[] }
let appliedAt = "", recentAt = "", relayAt = "", recentCheckedAt = 0;
/** After a new market file is mounted, the latest intraday prices must be applied again on top of it. */
export function forgetLive() { appliedAt = ""; recentAt = ""; relayAt = ""; recentCheckedAt = 0; }

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
export async function applyRecentDays(base: string, force = false): Promise<boolean> {
  // The file changes at most a few times a day: look at most every 10 minutes unless asked.
  if (!force && recentAt && Date.now() - recentCheckedAt < 10 * 60_000) return false;
  recentCheckedAt = Date.now();
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

/** Live prices during the session from the Cloudflare relay (about one minute behind the market). */
export async function applyRelay(): Promise<boolean> {
  if (!RELAY_URL) return false;
  let f: RelayFile;
  try {
    const r = await fetch(`${RELAY_URL}/live.json`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    f = await r.json();
  } catch { return false; }
  if (!f?.fetchedAt || f.fetchedAt === relayAt) return false;
  relayAt = f.fetchedAt;
  try {
    const q = applyQuotes(DB, "m.", f.quotes); // high/low are the relay's recorded range
    const i = q && f.indices?.length ? applyLiveIndices(DB, "m.", f.asOf, f.indices) : 0;
    return q || i > 0;
  } catch (e) { console.warn("[relay]", e); return false; }
}
