// Gathers everything the research verdict studies (shared/research.ts) for one stock, and caches it per data day.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import * as TR from "./trading.ts";
import { marketMood } from "./discover.ts";
import { evaluate } from "../../shared/opportunities.ts";
import { INDICATORS, defaults } from "../../shared/ta.ts";
import { interpret } from "../../shared/indicatorGuide.ts";
import { research, type Research } from "../../shared/research.ts";

/** Sector names in the company list and their NEPSE sub-index. */
const SECTOR_INDEX: Record<string, number> = {
  "Commercial Bank": 1, "Development Bank": 2, Finance: 3, "Hotel & Tourism": 5, Hydropower: 6, "Life Insurance": 8, "Manufacturing and Processing": 9,
  Microfinance: 10, "Mutual Fund": 11, "Non-Life Insurance": 13, Others: 14, Trading: 17, Investment: 18,
};

function indexState(id: number) {
  const rows = all<{ close: number; name: string }>("SELECT close, name FROM indices WHERE index_id = ? AND close > 0 ORDER BY date DESC LIMIT 200", id);
  if (rows.length < 20) return null;
  const avg = (n: number) => (rows.length >= n ? rows.slice(0, n).reduce((t, r) => t + r.close, 0) / n : null);
  return { name: rows[0].name, close: rows[0].close, sma50: avg(50), sma200: avg(200), ret20: rows.length > 20 ? ((rows[0].close - rows[20].close) / rows[20].close) * 100 : null };
}

let ctx: { key: string; mood: number | null; nepse: ReturnType<typeof indexState>; sectors: Map<number, ReturnType<typeof indexState>>; opps: Map<string, ReturnType<typeof TR.withLive>[number]> } | null = null;
function context() {
  const key = M.setupKeyPublic();
  if (ctx?.key === key) return ctx;
  let mood: number | null = null;
  try { mood = marketMood()?.score ?? null; } catch { /* not enough history */ }
  const opps = new Map(TR.withLive(TR.withTrack(TR.opportunities().rows)).map((o) => [o.symbol, o]));
  ctx = { key, mood, nepse: indexState(12), sectors: new Map(), opps };
  return ctx;
}

const cache = new Map<string, Research>();
export function researchFor(symbol: string): Research | null {
  const sym = symbol.toUpperCase();
  const c = M.company(sym);
  if (!c) return null;
  const cx = context();
  const newsN = get<{ n: number }>("SELECT COUNT(*) n FROM announcements WHERE symbol = ?", sym)?.n ?? 0;
  const key = `${cx.key}|${sym}|${newsN}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sector = c.sector || "Unclassified";
  const bars = M.bars(sym, { limit: 420, official: true }).bars;
  const faIn = TR.fundamentalInput(sym);
  const opp = cx.opps.get(sym) ?? TR.withLive(TR.withTrack([evaluate({ symbol: sym, name: c.name || sym, sector, bars, fundamentals: faIn, avgTurnover20: M.allFactors().find((f) => f.symbol === sym)?.avgTurnover20 ?? null, latestMarketDate: M.latestTradingDate() ?? "", fees: M.fees() })]))[0];
  // All indicators on closing prices.
  let tally: { bull: number; bear: number; neutral: number } | null = null;
  if (bars.length >= 60) {
    tally = { bull: 0, bear: 0, neutral: 0 };
    const close = bars[bars.length - 1].close;
    for (const d of INDICATORS) { try { const r = interpret(d, d.compute(bars, defaults(d)), close); if (!r.text.startsWith("Not enough")) tally[r.tone]++; } catch { /* skip */ } }
  }
  const news = all<{ published_date: string | null; title: string; category: string | null; url: string | null }>(
    "SELECT published_date, title, category, url FROM announcements WHERE symbol = ? AND COALESCE(published_date, substr(fetched_at, 1, 10)) >= date('now', '-60 days') ORDER BY COALESCE(published_date, fetched_at) DESC LIMIT 40", sym)
    .map((n) => ({ date: n.published_date, title: n.title, category: n.category, url: n.url }));
  const dividends = all<{ fiscal_year: string; cash_pct: number | null; bonus_pct: number | null; bookclose_date: string | null }>("SELECT fiscal_year, cash_pct, bonus_pct, bookclose_date FROM dividends WHERE symbol = ? ORDER BY fiscal_year DESC LIMIT 4", sym)
    .map((d) => ({ fiscalYear: d.fiscal_year, cashPct: d.cash_pct, bonusPct: d.bonus_pct, bookCloseDate: d.bookclose_date }));
  let audit: { fiscalYear: string | null; published: string | null; url: string } | null = null;
  try { const a = get<{ fiscal_year: string | null; published: string | null; url: string }>("SELECT fiscal_year, published, url FROM audit_docs WHERE symbol = ? ORDER BY COALESCE(published, '') DESC, fiscal_year DESC LIMIT 1", sym); if (a) audit = { fiscalYear: a.fiscal_year, published: a.published, url: a.url }; } catch { /* older data */ }
  const sid = SECTOR_INDEX[sector];
  if (sid != null && !cx.sectors.has(sid)) cx.sectors.set(sid, indexState(sid));
  const out = research({
    symbol: sym, name: c.name || sym, sector, opp, fa: M.fundamentalsFor(sym), faIn, indicators: tally, news, dividends, audit,
    market: { mood: cx.mood, nepse: cx.nepse }, sectorIndex: sid != null ? cx.sectors.get(sid) ?? null : null,
    today: new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10),
  });
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/** Research for the stocks that matter on the opportunities page: every BUY and SELL, and WATCH stocks with a buy range. */
export function computeResearchBoard() {
  const cx = context();
  const rows = [...cx.opps.values()].filter((o) => o.action === "BUY" || o.action === "SELL" || o.action === "HOLD" || (o.action === "WATCH" && o.entryLow != null));
  const out: Record<string, Pick<Research, "decision" | "tone" | "conviction" | "headline" | "agree">> = {};
  for (const o of rows) { try { const r = researchFor(o.symbol); if (r) out[o.symbol] = { decision: r.decision, tone: r.tone, conviction: r.conviction, headline: r.headline, agree: r.agree }; } catch (e) { console.warn(`[research] ${o.symbol}: ${e instanceof Error ? e.message : e}`); } }
  return out;
}
let board: { key: string; data: ReturnType<typeof computeResearchBoard> } | null = null;
export function researchBoard() {
  const key = M.setupKeyPublic();
  if (board?.key === key) return board.data;
  const pre = M.persistedPublic<ReturnType<typeof computeResearchBoard>>("research_board", key);
  board = { key, data: pre ?? computeResearchBoard() };
  return board.data;
}
