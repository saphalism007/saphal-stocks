// Gathers everything the research verdict studies (shared/research.ts) for one stock, and caches it per data day.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import * as TR from "./trading.ts";
import { marketMood } from "./discover.ts";
import { evaluate } from "../../shared/opportunities.ts";
import { INDICATORS, defaults } from "../../shared/ta.ts";
import { interpret } from "../../shared/indicatorGuide.ts";
import { research, type Research } from "../../shared/research.ts";
import { smartMoney, brokerFavourites, type FloorDay, type BrokerRow } from "../../shared/smartMoney.ts";
import { macro, type Macro, type MacroReport } from "../../shared/macro.ts";

const todayNpt = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);

/** The economy, policy and politics backdrop from stored NRB data and news headlines. */
export function macroNow(): Macro {
  let reports: MacroReport[] = [];
  try {
    reports = all<{ url: string; title: string; published: string; inflation: number | null; highlights: string | null }>("SELECT url, title, published, inflation, highlights FROM macro_reports WHERE title LIKE '%English%' OR title LIKE '%Months%' ORDER BY published DESC LIMIT 2")
      .map((r) => { let h: string[] = []; try { h = JSON.parse(r.highlights ?? "[]"); } catch { /* none */ } return { url: r.url, title: r.title, published: r.published, inflation: r.inflation, highlights: h }; });
  } catch { /* older data */ }
  let policyRate: Parameters<typeof macro>[0]["policyRate"] = null;
  try {
    const r = get<{ value: number; as_of: string; prev_value: number | null; prev_as_of: string | null }>("SELECT value, as_of, prev_value, prev_as_of FROM rates WHERE key = 'policy.policy_rate'");
    if (r) policyRate = { value: r.value, asOf: r.as_of, prev: r.prev_value, prevAsOf: r.prev_as_of };
  } catch { /* older data */ }
  const news = all<{ published_date: string | null; title: string; url: string | null }>("SELECT published_date, title, url FROM announcements WHERE symbol IS NULL AND category = 'News' ORDER BY COALESCE(published_date, fetched_at) DESC LIMIT 200")
    .map((n) => ({ date: n.published_date, title: n.title, url: n.url }));
  return macro({ reports, policyRate, news, today: todayNpt() });
}

/** Market-wide: what the 10 biggest brokers net bought and sold over the last 5 floorsheet sessions. */
export function favouritesNow() {
  try {
    const dates = all<{ date: string }>("SELECT DISTINCT date FROM floorsheet_day ORDER BY date DESC LIMIT 5").map((r) => r.date);
    if (!dates.length) return { brokers: [], buy: [], sell: [], sessions: 0, from: null as string | null, to: null as string | null };
    const rows = all<{ symbol: string; broker: number; buy_amt: number; sell_amt: number }>("SELECT f.symbol, f.broker, SUM(f.buy_amt) buy_amt, SUM(f.sell_amt) sell_amt FROM floorsheet_broker f JOIN companies c ON c.symbol = f.symbol WHERE f.date >= ? AND COALESCE(c.sector, '') NOT IN ('Corporate Debentures', 'Government Bonds', 'Mutual Fund', 'Promoter Share') GROUP BY f.symbol, f.broker", dates[dates.length - 1])
      .map((r) => ({ symbol: r.symbol, broker: r.broker, buyAmt: r.buy_amt ?? 0, sellAmt: r.sell_amt ?? 0 }));
    return { ...brokerFavourites(rows), sessions: dates.length, from: dates[dates.length - 1], to: dates[0] };
  } catch { return { brokers: [], buy: [], sell: [], sessions: 0, from: null, to: null }; }
}

function smartFor(sym: string, bars: ReturnType<typeof M.bars>["bars"], listedShares: number | null, fav: ReturnType<typeof favouritesNow>) {
  let floor: FloorDay[] = [], brokers: BrokerRow[] = [];
  try {
    const dates = all<{ date: string }>("SELECT date FROM floorsheet_day WHERE symbol = ? ORDER BY date DESC LIMIT 10", sym).map((r) => r.date);
    if (dates.length) {
      const from = dates[dates.length - 1];
      let fd: { date: string; qty: number; amount: number; trades: number; buyers: number | null; sellers: number | null; cross_qty?: number | null }[];
      try { fd = all("SELECT date, qty, amount, trades, buyers, sellers, cross_qty FROM floorsheet_day WHERE symbol = ? AND date >= ?", sym, from); }
      catch { fd = all("SELECT date, qty, amount, trades, buyers, sellers FROM floorsheet_day WHERE symbol = ? AND date >= ?", sym, from); }
      floor = fd.map((r) => ({ date: r.date, qty: r.qty, amount: r.amount, trades: r.trades, buyers: r.buyers, sellers: r.sellers, crossQty: r.cross_qty ?? null }));
      brokers = all<{ date: string; broker: number; buy_qty: number; sell_qty: number }>("SELECT date, broker, buy_qty, sell_qty FROM floorsheet_broker WHERE symbol = ? AND date >= ?", sym, from)
        .map((r) => ({ date: r.date, broker: r.broker, buyQty: r.buy_qty ?? 0, sellQty: r.sell_qty ?? 0 }));
    }
  } catch { /* no floorsheet tables */ }
  const bi = fav.buy.findIndex((x) => x.symbol === sym), si = fav.sell.findIndex((x) => x.symbol === sym);
  const favourite = bi >= 0 ? { rank: bi + 1, of: fav.buy.length, side: "buy" as const } : si >= 0 ? { rank: si + 1, of: fav.sell.length, side: "sell" as const } : null;
  return smartMoney({ bars, listedShares, floor, brokers, favourite });
}

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

let ctx: { key: string; macro: Macro; fav: ReturnType<typeof favouritesNow>; mood: number | null; nepse: ReturnType<typeof indexState>; sectors: Map<number, ReturnType<typeof indexState>>; opps: Map<string, ReturnType<typeof TR.withLive>[number]> } | null = null;
function context() {
  const key = M.setupKeyPublic();
  if (ctx?.key === key) return ctx;
  let mood: number | null = null;
  try { mood = marketMood()?.score ?? null; } catch { /* not enough history */ }
  const opps = new Map(TR.withLive(TR.withTrack(TR.opportunities().rows)).map((o) => [o.symbol, o]));
  ctx = { key, macro: macroNow(), fav: favouritesNow(), mood, nepse: indexState(12), sectors: new Map(), opps };
  return ctx;
}

const cache = new Map<string, Research>();
export function researchFor(symbol: string): Research | null {
  const sym = symbol.toUpperCase();
  const c = M.company(sym);
  if (!c) return null;
  const cx = context();
  const newsN = get<{ n: number }>("SELECT COUNT(*) n FROM announcements WHERE symbol = ? OR (symbol IS NULL AND category = 'News')", sym)?.n ?? 0;
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
    smart: bars.length >= 60 ? smartFor(sym, bars, c.listed_shares ?? null, cx.fav) : null, macro: cx.macro,
    today: todayNpt(),
  });
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/** Research for the stocks that matter on the opportunities page: every BUY and SELL, and WATCH stocks with a buy range. */
export function computeResearchBoard() {
  const cx = context();
  const rows = [...cx.opps.values()].filter((o) => o.action === "BUY" || o.action === "SELL" || o.action === "HOLD" || (o.action === "WATCH" && o.entryLow != null));
  const out: Record<string, Pick<Research, "decision" | "tone" | "conviction" | "headline" | "agree"> & { smart?: { phase: string; risk: string; brokerRead: string } }> = {};
  for (const o of rows) { try { const r = researchFor(o.symbol); if (r) out[o.symbol] = { decision: r.decision, tone: r.tone, conviction: r.conviction, headline: r.headline, agree: r.agree, smart: r.smart ? { phase: r.smart.phase, risk: r.smart.risk, brokerRead: r.smart.brokerRead } : undefined }; } catch (e) { console.warn(`[research] ${o.symbol}: ${e instanceof Error ? e.message : e}`); } }
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

/** Market-wide smart money and economy page data: broker favourites, the macro backdrop, and stocks with operator footprints. */
export function marketIntel() {
  const cx = context();
  const board = researchBoard();
  const flagged = Object.entries(board).filter(([, v]) => v.smart?.risk === "High").map(([symbol, v]) => ({ symbol, phase: v.smart!.phase, brokerRead: v.smart!.brokerRead, decision: v.decision }));
  const accumulating = Object.entries(board).filter(([, v]) => v.smart && (v.smart.brokerRead === "Accumulation" || v.smart.phase === "Accumulation") && v.smart.risk !== "High").map(([symbol, v]) => ({ symbol, phase: v.smart!.phase, brokerRead: v.smart!.brokerRead, decision: v.decision }));
  const distributing = Object.entries(board).filter(([, v]) => v.smart && (v.smart.brokerRead === "Distribution" || v.smart.phase === "Distribution")).map(([symbol, v]) => ({ symbol, phase: v.smart!.phase, brokerRead: v.smart!.brokerRead, decision: v.decision }));
  return { macro: cx.macro, favourites: cx.fav, flagged, accumulating, distributing };
}
