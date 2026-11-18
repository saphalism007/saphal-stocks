// Reads ShareSansar's live-trading page (https://www.sharesansar.com/live-trading): the prices during market hours,
// updated through the session. Used by the Cloudflare relay (relay/), which publishes them about once a minute for
// every device, and by the Mac version as a fallback. Pure code with no Node or browser APIs, so it runs anywhere.
import type { LiveFile } from "./published.ts";

export const LIVE_TRADING_URL = "https://www.sharesansar.com/live-trading";
/** The Cloudflare relay (relay/) that serves these prices to every device. */
export const RELAY_URL = "https://saphal-stocks-live.saphalstocks.workers.dev";

/** Nepal time is within the trading session (just before 11:00 until shortly after 15:00, Monday to Friday). */
export function inLiveSession(now = Date.now()) {
  const d = new Date(now + 345 * 60_000), m = d.getUTCHours() * 60 + d.getUTCMinutes(), w = d.getUTCDay();
  return w >= 1 && w <= 5 && m >= 10 * 60 + 58 && m <= 15 * 60 + 15;
}

/** Index names on the page and the index ids used in the price history (same ids as ShareSansar's index history). */
export const LIVE_INDEX_IDS: Record<string, number> = {
  "NEPSE Index": 12, "Sensitive Index": 16, "Float Index": 4, "Sensitive Float Index": 15, "Banking SubIndex": 1, "Development Bank Index": 2,
  "Finance Index": 3, "Hotels And Tourism": 5, "HydroPower Index": 6, "Insurance": 7, "Life Insurance": 8, "Non Life Insurance": 13,
  "Manufacturing And Processing": 9, "Microfinance Index": 10, "Mutual Fund": 11, "Others Index": 14, "Trading Index": 17, "Investment": 18,
};

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, (e) => ENT[e] ?? " ").replace(/\s+/g, " ").trim();
const num = (s: string | undefined): number | null => {
  const m = (s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  const v = m ? Number(m[0]) : NaN;
  return Number.isFinite(v) ? v : null;
};

export interface LiveIndex { id: number | null; name: string; value: number; changePct: number | null; turnover: number | null }
export interface LiveTrading { asOf: string; time: string; marketOpen: boolean | null; quotes: LiveFile; indices: LiveIndex[] }

/** Parses the page. Throws when the layout is not recognised (never returns made-up numbers). */
export function parseLiveTrading(html: string, fetchedAt: string): LiveTrading {
  const stamp = html.match(/id="dDate"[^>]*>\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (!stamp) throw new Error("live-trading: no 'As of' date on the page");
  const asOf = stamp[1], time = stamp[2] ?? "";
  const status = html.match(/btn btn-\w+">\s*Market\s+(Open|Close|Closed)\s*</i)?.[1];
  const marketOpen = status ? /open/i.test(status) : null;

  const table = html.match(/<table[^>]*id="headFixed"[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error("live-trading: price table not found");
  const head = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]).toLowerCase());
  const col = (n: string) => head.indexOf(n.toLowerCase());
  const ix = { sym: col("Symbol"), ltp: col("LTP"), chg: col("Point Change"), pct: col("% Change"), open: col("Open"), high: col("High"), low: col("Low"), vol: col("Volume"), prev: col("Prev. Close") };
  if (ix.sym < 0 || ix.ltp < 0) throw new Error("live-trading: table layout changed (Symbol/LTP columns not found)");
  const rows: (string | number | null)[][] = [];
  const body = table.split(/<tbody[^>]*>/)[1] ?? "";
  for (const tr of body.split(/<tr[^>]*>/).slice(1)) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    const symbol = c[ix.sym]?.toUpperCase();
    const ltp = num(c[ix.ltp]);
    if (!symbol || !/^[A-Z0-9]+$/.test(symbol) || ltp == null || ltp <= 0) continue;
    const g = (i: number) => (i >= 0 ? num(c[i]) : null);
    // Columns as in live.json (shared/published.ts): close is the last traded price until the official close.
    rows.push([symbol, g(ix.open), g(ix.high), g(ix.low), ltp, ltp, g(ix.prev), g(ix.chg), g(ix.pct), null, g(ix.vol), null, null, null, null]);
  }
  if (rows.length < 20) throw new Error(`live-trading: only ${rows.length} prices found`);

  const indices: LiveIndex[] = [];
  for (const m of html.matchAll(/<h4>([^<]+)<\/h4>\s*<p class="mu-price">([^<]*)<\/p>\s*<p>\s*<span\s+class="mu-value[^"]*"\s*>([^<]*)<\/span>\s*<span\s+class="mu-percent[^"]*"\s*>([^<]*)</g)) {
    const name = text(m[1]), value = num(m[3]);
    if (value == null || value <= 0) continue;
    const turnover = num(m[2]);
    // Long names are cut short on the page ("Development Bank Ind."): match them by their start.
    const full = LIVE_INDEX_IDS[name] != null ? name : Object.keys(LIVE_INDEX_IDS).find((k) => name.endsWith(".") && k.startsWith(name.slice(0, -1))) ?? name;
    indices.push({ id: LIVE_INDEX_IDS[full] ?? null, name: full, value, changePct: num(m[4]), turnover: turnover && turnover > 0 ? turnover : null });
  }

  return {
    asOf, time, marketOpen, indices,
    quotes: { generatedAt: fetchedAt, asOf, columns: ["symbol", "open", "high", "low", "close", "ltp", "prev_close", "change", "change_pct", "vwap", "volume", "turnover", "trades", "high52", "low52"], quotes: rows },
  };
}
