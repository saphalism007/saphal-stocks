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
  const file: RelayFile = { fetchedAt: at, asOf: p.asOf, time: p.time, marketOpen: p.marketOpen, quotes: p.quotes, indices: p.indices };
  await env.LIVE.put("live", JSON.stringify(file), { expirationTtl: 7 * 86_400 });
  return `${p.quotes.quotes.length} prices as of ${p.asOf} ${p.time}`;
}

const cors = (origin: string | null): Record<string, string> => (origin && ALLOWED.includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {});

export default {
  async scheduled(_e: unknown, env: Env) {
    if (!inSession()) return;
    try { await refresh(env); } catch (e) { await env.LIVE.put("error", `${new Date().toISOString()} ${e instanceof Error ? e.message : e}`, { expirationTtl: 86_400 }); }
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url), origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors(origin), "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    if (url.pathname === "/live.json") {
      let body = await env.LIVE.get("live");
      // First use, or nothing stored yet: fetch once now (at most once a minute, by the stored time).
      if (!body) { try { await refresh(env); body = await env.LIVE.get("live"); } catch { /* fall through */ } }
      if (!body) return new Response(JSON.stringify({ error: "No live prices yet" }), { status: 503, headers: { "Content-Type": "application/json", ...cors(origin) } });
      return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
    }
    if (url.pathname === "/health") {
      const [body, error] = await Promise.all([env.LIVE.get("live"), env.LIVE.get("error")]);
      const f = body ? (JSON.parse(body) as RelayFile) : null;
      return Response.json({ ok: !!f, fetchedAt: f?.fetchedAt ?? null, asOf: f?.asOf ?? null, time: f?.time ?? null, marketOpen: f?.marketOpen ?? null, prices: f?.quotes.quotes.length ?? 0, inSession: inSession(), lastError: error }, { headers: cors(origin) });
    }
    return new Response("Saphal Stocks live prices: /live.json, /health", { headers: { "Content-Type": "text/plain" } });
  },
};
