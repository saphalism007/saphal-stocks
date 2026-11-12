// Writes web/public/data/live.json: the latest quotes, for intraday updates between daily snapshots.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../server/config.ts";
import { all, get } from "../server/db.ts";

const cols = ["symbol", "open", "high", "low", "close", "ltp", "prev_close", "change", "change_pct", "vwap", "volume", "turnover", "trades", "high52", "low52"];
const asOf = get<{ d: string }>("SELECT MAX(date) d FROM quotes")?.d;
const rows = all<Record<string, unknown>>(`SELECT ${cols.join(", ")} FROM quotes WHERE date = ?`, asOf);
// Announcements and news from the last 3 days, so the app has the morning news before the open.
const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const ncols = ["symbol", "title", "url", "published_date", "category", "source", "fetched_at"];
const news = all<Record<string, unknown>>(`SELECT ${ncols.join(", ")} FROM announcements WHERE url IS NOT NULL AND (published_date >= ? OR fetched_at >= ?) ORDER BY COALESCE(fetched_at, published_date) DESC LIMIT 120`, since, since);
const f = get<{ last_success_at: string }>("SELECT last_success_at FROM data_freshness WHERE dataset = 'prices_latest'");
mkdirSync(join(ROOT, "web", "public", "data"), { recursive: true });
writeFileSync(join(ROOT, "web", "public", "data", "live.json"), JSON.stringify({ generatedAt: f?.last_success_at ?? new Date().toISOString(), asOf, columns: cols, quotes: rows.map((r) => cols.map((c) => r[c] ?? null)), newsColumns: ncols, news: news.map((r) => ncols.map((c) => r[c] ?? null)) }));
console.log(`live.json: ${rows.length} quotes as of ${asOf}, ${news.length} news items`);
