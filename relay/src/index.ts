import { parseLiveTrading, LIVE_TRADING_URL } from "../../shared/liveTrading.ts";
import type { RelayFile } from "../../shared/published.ts";

interface Env { LIVE: KVNamespace }
interface KVNamespace { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }

const ALLOWED = ["https://saphalism007.github.io", "http://127.0.0.1:5181", "http://localhost:5181", "http://localhost:5180", "http://localhost:5186"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 SaphalStocks/0.1";

/** Nepal time now (UTC+5:45). */
const npt = () => { const d = new Date(Date.now() + 345 * 60_000); return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() }; };
/** From just before the 11:00 open until shortly after the 15:00 close, Monday to Friday. */
const inSession = () => { const n = npt(); return n.weekday >= 1 && n.weekday <= 5 && n.minutes >= 10 * 60 + 58 && n.minutes <= 15 * 60 + 12; };

async function refresh(env: Env): Promise<string> {
  const res = await fetch(LIVE_TRADING_URL, { headers: { "User-Agent": UA, Accept: "text/html" }, cf: { cacheTtl: 0 } } as RequestInit);
  if (!res.ok) throw new Error(`ShareSansar answered ${res.status}`);
  const at = new Date().toISOString();
  const p = parseLiveTrading(await res.text(), at);
  const range = await recordTicks(env, p.asOf, p.time, p.quotes.quotes);
  // Today's high and low: ShareSansar's own High/Low for today (the page is checked to carry today's date), widened by
  // any price the relay recorded beyond them. The official close data replaces the candle in the evening.
  const ci = (c: string) => p.quotes.columns.indexOf(c);
  for (const r of p.quotes.quotes) {
    const g = range[String(r[0])]; if (!g) continue;
    const hi = Number(r[ci("high")]), lo = Number(r[ci("low")]);
    r[ci("high")] = Number.isFinite(hi) && hi > 0 ? Math.max(hi, g[0]) : g[0];
    r[ci("low")] = Number.isFinite(lo) && lo > 0 ? Math.min(lo, g[1]) : g[1];
  }
  const file: RelayFile = { fetchedAt: at, asOf: p.asOf, time: p.time, marketOpen: p.marketOpen, quotes: p.quotes, indices: p.indices };
  await env.LIVE.put("live", JSON.stringify(file), { expirationTtl: 7 * 86_400 });
  return `${p.quotes.quotes.length} prices as of ${p.asOf} ${p.time}`;
}

/** Minute-by-minute record of the day for intraday charts: one line per page update, "HH:MM:SS|SYM:ltp:volume,...",
 *  holding only the stocks whose price or volume changed since the previous line (the first line holds all). */
async function recordTicks(env: Env, date: string, time: string, rows: (string | number | null)[][]): Promise<Record<string, [number, number]>> {
  const lastKey = `last:${date}`, dayKey = `ticks:${date}`;
  // p: last [price, volume] per stock; r: the day's [high, low] from the open and every recorded price.
  const prev = JSON.parse((await env.LIVE.get(lastKey)) ?? '{"time":"","p":{},"r":{}}') as { time: string; p: Record<string, [number, number]>; r?: Record<string, [number, number]> };
  prev.r ??= {};
  const fresh = !!time && time > prev.time;
  const parts: string[] = [];
  for (const r of rows) {
    const sym = String(r[0]), ltp = Number(r[5]), vol = Number(r[10] ?? 0), open = Number(r[1]);
    if (!Number.isFinite(ltp) || ltp <= 0) continue;
    const g = prev.r[sym] ?? [Number.isFinite(open) && open > 0 ? Math.max(open, ltp) : ltp, Number.isFinite(open) && open > 0 ? Math.min(open, ltp) : ltp];
    prev.r[sym] = [Math.max(g[0], ltp), Math.min(g[1], ltp)];
    const old = prev.p[sym];
    if (fresh && (!old || old[0] !== ltp || old[1] !== vol)) { parts.push(`${sym}:${ltp}:${vol}`); prev.p[sym] = [ltp, vol]; }
  }
  if (fresh) {
    prev.time = time;
    const day = (await env.LIVE.get(dayKey)) ?? "";
    if (parts.length) await env.LIVE.put(dayKey, `${day}${time}|${parts.join(",")}\n`, { expirationTtl: 45 * 86_400 });
    await env.LIVE.put(lastKey, JSON.stringify(prev), { expirationTtl: 3 * 86_400 });
  }
  return prev.r;
}

const cors = (origin: string | null): Record<string, string> => (origin && ALLOWED.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {});

export default {
  async scheduled(_e: unknown, env: Env) {
    if (!inSession()) return;
    try { await refresh(env); } catch (e) { await env.LIVE.put("error", `${new Date().toISOString()} ${e instanceof Error ? e.message : e}`, { expirationTtl: 86_400 }); }
  },
  async fetch(req: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(req.url), origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors(origin), "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    if (url.pathname === "/live.json") {
      let body = await env.LIVE.get("live");
      // Backup for the timer: during the session, if the stored prices are over 90 seconds old, refresh them now
      // (the device gets the stored copy at once; the next request gets the new one).
      const age = body ? Date.now() - Date.parse((JSON.parse(body) as RelayFile).fetchedAt) : Infinity;
      if (body && inSession() && age > 90_000) ctx.waitUntil(refresh(env).catch((e) => env.LIVE.put("error", `${new Date().toISOString()} ${e instanceof Error ? e.message : e}`, { expirationTtl: 86_400 })));
      // First use, or nothing stored yet: fetch once now (at most once a minute, by the stored time).
      if (!body) { try { await refresh(env); body = await env.LIVE.get("live"); } catch { /* fall through */ } }
      if (!body) return new Response(JSON.stringify({ error: "No live prices yet" }), { status: 503, headers: { "Content-Type": "application/json", ...cors(origin) } });
      return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
    }
    if (url.pathname === "/intraday.txt") {
      // The day's minute record (today by default). ?since=HH:MM:SS returns only the lines after that time.
      const date = url.searchParams.get("date") ?? ((JSON.parse((await env.LIVE.get("live")) ?? "{}") as Partial<RelayFile>).asOf ?? "");
      let body = /^\d{4}-\d{2}-\d{2}$/.test(date) ? (await env.LIVE.get(`ticks:${date}`)) ?? "" : "";
      const since = url.searchParams.get("since");
      if (since && /^\d{2}:\d{2}:\d{2}$/.test(since)) { const i = body.indexOf(`${since}|`); if (i >= 0) { const nl = body.indexOf("\n", i); body = nl >= 0 ? body.slice(nl + 1) : ""; } }
      return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Date": date, "Access-Control-Expose-Headers": "X-Date", ...cors(origin) } });
    }
    if (url.pathname === "/health") {
      const [body, error] = await Promise.all([env.LIVE.get("live"), env.LIVE.get("error")]);
      const f = body ? (JSON.parse(body) as RelayFile) : null;
      return Response.json({ ok: !!f, fetchedAt: f?.fetchedAt ?? null, asOf: f?.asOf ?? null, time: f?.time ?? null, marketOpen: f?.marketOpen ?? null, prices: f?.quotes.quotes.length ?? 0, inSession: inSession(), lastError: error }, { headers: cors(origin) });
    }
    return new Response("Saphal Stocks live prices: /live.json, /health", { headers: { "Content-Type": "text/plain" } });
  },
};
