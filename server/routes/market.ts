import { Router } from "express";
import { z } from "zod";
import { all, get } from "../db.ts";
import * as M from "../lib/market.ts";
import { RANK_STRATEGIES, rankStocks } from "../../shared/ranking.ts";
import { runBacktest, runPortfolioBacktest, STRATEGIES, type StrategyId } from "../../shared/backtest.ts";
import { patternTrackRecord } from "../../shared/patterns.ts";
import { syncCompanyDetail, syncHistory } from "../ingest/jobs.ts";
import { buildStockReport } from "../ai/offline.ts";
import * as MON from "../lib/money.ts";
import { debentureYield } from "../../shared/money.ts";

export const marketRouter = Router();
const SYM = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/, "Invalid symbol");

marketRouter.get("/market/summary", (_req, res) => res.json(M.marketSummary()));

marketRouter.get("/market/indices", (_req, res) => {
  res.json(all(`SELECT i.* FROM indices i JOIN (SELECT index_id, MAX(date) d FROM indices GROUP BY index_id) m ON m.index_id = i.index_id AND m.d = i.date ORDER BY i.index_id`));
});

marketRouter.get("/market/index/:id", (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const from = typeof req.query.from === "string" ? req.query.from : "1900-01-01";
  res.json(all("SELECT date, open, high, low, close, change_pct, turnover FROM indices WHERE index_id = ? AND date >= ? ORDER BY date", id, from));
});

marketRouter.get("/market/breadth-history", (_req, res) => {
  // Advance/decline counts per day from stored prices (last 120 sessions).
  const rows = all<{ date: string; adv: number; dec: number; turnover: number }>(`
    WITH d AS (SELECT DISTINCT date FROM prices ORDER BY date DESC LIMIT 121),
    p AS (SELECT symbol, date, close, LAG(close) OVER (PARTITION BY symbol ORDER BY date) prev, amount FROM prices WHERE date IN (SELECT date FROM d))
    SELECT date, SUM(close > prev) adv, SUM(close < prev) dec, SUM(COALESCE(amount, 0)) turnover FROM p WHERE prev IS NOT NULL GROUP BY date ORDER BY date`);
  res.json(rows);
});

marketRouter.get("/stocks", (_req, res) => {
  const factors = new Map(M.allFactors().map((f) => [f.symbol, f]));
  const rows = all<Record<string, unknown> & { symbol: string }>(`SELECT c.symbol, c.name, c.sector, c.listed_shares, q.date, q.close, q.change_pct, q.volume, q.turnover, q.high52, q.low52,
    (SELECT COUNT(*) FROM reports r WHERE r.symbol = c.symbol) reports FROM companies c LEFT JOIN quotes q ON q.symbol = c.symbol WHERE c.status = 'active' ORDER BY c.symbol`);
  res.json(rows.map((r) => {
    const f = factors.get(r.symbol);
    return { ...r, marketCap: r.close && r.listed_shares ? (r.close as number) * (r.listed_shares as number) : null, fundamentalScore: f?.fundamentalScore ?? null, technicalScore: f?.technicalScore ?? null, pe: f?.pe ?? null, pb: f?.pb ?? null, roe: f?.roe ?? null, cashYield: f?.cashYield ?? null, return3m: f?.return3m ?? null, return1y: f?.return1y ?? null, trend: f?.trend ?? null, rsi: f?.rsi ?? null, avgTurnover20: f?.avgTurnover20 ?? null };
  }));
});

marketRouter.get("/factors", (_req, res) => res.json({ asOf: M.latestTradingDate(), rows: M.allFactors() }));

marketRouter.get("/stocks/:symbol", (req, res) => {
  const sym = SYM.parse(req.params.symbol);
  const a = M.analyzeStock(sym);
  if (!a.company) return res.status(404).json({ error: `${sym} is not in the database. Run a data refresh or check the symbol.` });
  res.json(a);
});

marketRouter.get("/stocks/:symbol/bars", (req, res) => {
  const sym = SYM.parse(req.params.symbol);
  const b = M.bars(sym, { adjusted: req.query.adjusted !== "0" });
  res.json({ symbol: sym, bars: b.bars, adjustments: b.adjustments, rightAdjustments: b.rightAdjustments, skipped: b.skippedAdjustments });
});

marketRouter.get("/stocks/:symbol/report", (req, res) => {
  const r = buildStockReport(SYM.parse(req.params.symbol));
  if (!r) return res.status(404).json({ error: "Unknown symbol" });
  res.json(r);
});

marketRouter.get("/stocks/:symbol/statements", (req, res) => res.json(M.reportsFor(SYM.parse(req.params.symbol))));

marketRouter.get("/stocks/:symbol/announcements", (req, res) => {
  res.json(all("SELECT id, title, url, published_date, category, source FROM announcements WHERE symbol = ? ORDER BY published_date DESC, id DESC LIMIT 100", SYM.parse(req.params.symbol)));
});

marketRouter.get("/stocks/:symbol/pattern-history", (req, res) => {
  const b = M.bars(SYM.parse(req.params.symbol)).bars.slice(-1500);
  res.json({ sessions: b.length, from: b[0]?.date, to: b[b.length - 1]?.date, records: patternTrackRecord(b) });
});

marketRouter.post("/stocks/:symbol/refresh", async (req, res) => {
  const sym = SYM.parse(req.params.symbol);
  if (!get("SELECT 1 FROM companies WHERE symbol = ?", sym)) return res.status(404).json({ error: "Unknown symbol" });
  const detail = await syncCompanyDetail(sym);
  const n = get<{ n: number }>("SELECT COUNT(*) n FROM prices WHERE symbol = ?", sym)!.n;
  let history = 0;
  if (n < 30 || req.query.history === "1") history = await syncHistory(undefined, { symbols: [sym], force: true });
  res.json({ ok: true, ...detail, historyRows: history });
});

marketRouter.get("/sectors", (_req, res) => {
  const rows = M.allFactors();
  const by = new Map<string, typeof rows>();
  for (const r of rows) { const a = by.get(r.sector) || []; a.push(r); by.set(r.sector, a); }
  const med = (v: (number | null)[]) => { const x = v.filter((n): n is number => n != null && Number.isFinite(n)).sort((a, b) => a - b); return x.length ? Math.round(x[Math.floor(x.length / 2)] * 100) / 100 : null; };
  res.json([...by.entries()].map(([sector, list]) => ({
    sector, count: list.length, medianPe: med(list.map((r) => r.pe)), medianPb: med(list.map((r) => r.pb)), medianRoe: med(list.map((r) => r.roe)),
    medianYield: med(list.map((r) => r.cashYield)), medianReturn3m: med(list.map((r) => r.return3m)), medianReturn1y: med(list.map((r) => r.return1y)),
    medianFundamental: med(list.map((r) => r.fundamentalScore)), medianTechnical: med(list.map((r) => r.technicalScore)),
    uptrend: list.filter((r) => r.trend === "uptrend").length, turnover20: list.reduce((s, r) => s + (r.avgTurnover20 ?? 0), 0),
  })).sort((a, b) => b.turnover20 - a.turnover20));
});

marketRouter.get("/rank/strategies", (_req, res) => {
  res.json(RANK_STRATEGIES.map((s) => ({ key: s.key, name: s.name, horizon: s.horizon, kind: s.kind, description: s.description, weights: s.weights, filters: s.filters.map((f) => f.label) })));
});

marketRouter.get("/rank/:key", (req, res) => {
  const strat = RANK_STRATEGIES.find((s) => s.key === req.params.key);
  if (!strat) return res.status(404).json({ error: "Unknown strategy" });
  let weights: Record<string, number> | undefined;
  if (typeof req.query.weights === "string") weights = z.record(z.number().min(0).max(10)).parse(JSON.parse(req.query.weights));
  let rows = M.allFactors();
  if (typeof req.query.sector === "string" && req.query.sector) rows = rows.filter((r) => r.sector === req.query.sector);
  const r = rankStocks(rows, strat, weights, Number(req.query.limit) || 50);
  res.json({ asOf: M.latestTradingDate(), universe: rows.length, ...r });
});

marketRouter.get("/setups", (req, res) => {
  const side = req.query.side as string | undefined;
  res.json({ asOf: M.latestTradingDate(), setups: M.allSetups(300).filter((s) => !side || s.side === side) });
});

marketRouter.get("/backtest/strategies", (_req, res) => res.json(STRATEGIES));

marketRouter.post("/backtest", (req, res) => {
  const p = z.object({
    symbol: SYM, strategy: z.enum(STRATEGIES.map((s) => s.id) as [StrategyId, ...StrategyId[]]), params: z.record(z.number()).optional(),
    from: z.string().optional(), to: z.string().optional(), capital: z.number().positive().max(1e10).optional(),
    stopLossPct: z.number().min(0).max(90).nullable().optional(), takeProfitPct: z.number().min(0).max(1000).nullable().optional(),
    maxHoldDays: z.number().int().min(1).max(2000).nullable().optional(), slippagePct: z.number().min(0).max(5).optional(), adjusted: z.boolean().optional(),
  }).parse(req.body);
  const b = M.bars(p.symbol, { adjusted: p.adjusted !== false }).bars;
  if (b.length < 60) return res.status(400).json({ error: "Not enough price history for a backtest." });
  const r = runBacktest(b, { ...p, fees: M.fees() });
  res.json(r);
});

marketRouter.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim().toUpperCase();
  if (!q) return res.json([]);
  res.json(all("SELECT symbol, name, sector FROM companies WHERE UPPER(symbol) LIKE ? OR UPPER(name) LIKE ? ORDER BY (UPPER(symbol) = ?) DESC, (UPPER(symbol) LIKE ?) DESC, symbol LIMIT 12", `%${q}%`, `%${q}%`, q, `${q}%`));
});

marketRouter.get("/news", (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (typeof req.query.category === "string" && req.query.category) { where.push("category = ?"); params.push(req.query.category); }
  if (typeof req.query.symbol === "string" && req.query.symbol) { where.push("symbol = ?"); params.push(req.query.symbol.toUpperCase()); }
  if (typeof req.query.q === "string" && req.query.q) { where.push("title LIKE ?"); params.push(`%${req.query.q}%`); }
  const rows = all(`SELECT a.id, a.symbol, a.title, a.url, a.published_date, a.category, a.source, a.fetched_at, c.sector FROM announcements a LEFT JOIN companies c ON c.symbol = a.symbol
    ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.published_date DESC, a.id DESC LIMIT ?`, ...params, Math.min(Number(req.query.limit) || 100, 500));
  const cats = all("SELECT category, COUNT(*) n FROM announcements GROUP BY category ORDER BY n DESC");
  res.json({ rows, categories: cats });
});

marketRouter.get("/forex", (_req, res) => {
  res.json(all("SELECT * FROM forex WHERE date = (SELECT MAX(date) FROM forex) ORDER BY currency"));
});

// ---------- public issues (IPO/FPO/rights) with listing performance ----------
function issueStatus(r: { status: number | null; opening_date: string | null; closing_date: string | null; final_date: string | null; listing_date: string | null }, today: string) {
  const open = r.opening_date || null, close = r.final_date || r.closing_date || null;
  if (open && close && open <= today && today <= close) return "Open now";
  if (open && open > today) return "Opening soon";
  if (r.status === -2 || !open) return "Approved / upcoming";
  if (r.listing_date && r.listing_date <= today) return "Listed";
  return "Closed";
}

marketRouter.get("/issues", (req, res) => {
  const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const type = typeof req.query.type === "string" && req.query.type ? req.query.type : null;
  const rows = all<Record<string, unknown> & { symbol: string | null; price: number | null; listing_date: string | null; status: number | null; opening_date: string | null; closing_date: string | null; final_date: string | null; issue_type: string }>(
    `SELECT i.*, c.sector FROM issues i LEFT JOIN companies c ON c.symbol = i.symbol ${type ? "WHERE i.issue_type = ?" : ""} ORDER BY (i.opening_date = '') DESC, i.opening_date DESC LIMIT 600`, ...(type ? [type] : []));
  res.json(rows.map((r) => {
    let perf: Record<string, number | string | null> | null = null;
    if (r.symbol && r.listing_date && r.price && /IPO|FPO/.test(r.issue_type)) {
      const bars = all<{ date: string; close: number }>("SELECT date, close FROM prices WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 60", r.symbol, r.listing_date);
      const last = get<{ date: string; close: number }>("SELECT date, close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1", r.symbol);
      const nearListing = bars.length && Date.parse(bars[0].date) - Date.parse(r.listing_date) <= 7 * 86_400_000;
      if (bars.length && !nearListing) perf = { note: `Price history around listing is not available (first stored session ${bars[0].date}).`, lastClose: get<{ close: number }>("SELECT close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1", r.symbol)?.close ?? null, sinceIssuePct: null } as Record<string, number | string | null>;
      if (bars.length && nearListing) {
        const ret = (p: number | undefined) => (p == null ? null : Math.round(((p - (r.price as number)) / (r.price as number)) * 1000) / 10);
        perf = { firstDate: bars[0].date, firstClose: bars[0].close, firstDayPct: ret(bars[0].close), after20Pct: ret(bars[19]?.close), lastClose: last?.close ?? null, lastDate: last?.date ?? null, sinceIssuePct: ret(last?.close) };
      }
    }
    return { ...r, statusLabel: issueStatus(r, today), performance: perf };
  }));
});

marketRouter.get("/issues/ipo-stats", (_req, res) => {
  const rows = all<{ symbol: string; price: number; listing_date: string; sector: string | null }>(
    "SELECT i.symbol, i.price, i.listing_date, c.sector FROM issues i LEFT JOIN companies c ON c.symbol = i.symbol WHERE i.issue_type = 'IPO' AND i.listing_date IS NOT NULL AND i.price > 0 AND i.symbol IS NOT NULL");
  const out: { symbol: string; sector: string | null; listing: string; firstClosePct: number; d20Pct: number | null; nowPct: number | null }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const b = all<{ close: number }>("SELECT close FROM prices WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 21", r.symbol, r.listing_date);
    const last = get<{ close: number }>("SELECT close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1", r.symbol);
    const first = get<{ date: string }>("SELECT date FROM prices WHERE symbol = ? AND date >= ? ORDER BY date LIMIT 1", r.symbol, r.listing_date);
    if (!b.length || !first || Date.parse(first.date) - Date.parse(r.listing_date) > 7 * 86_400_000) { skipped++; continue; }
    const pct = (p: number) => ((p - r.price) / r.price) * 100;
    out.push({ symbol: r.symbol, sector: r.sector, listing: r.listing_date, firstClosePct: pct(b[0].close), d20Pct: b[20] ? pct(b[20].close) : null, nowPct: last ? pct(last.close) : null });
  }
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null; };
  const d20 = out.map((o) => o.d20Pct).filter((x): x is number => x != null);
  res.json({
    count: out.length, skippedNoListingHistory: skipped,
    medianFirstDayPct: med(out.map((o) => o.firstClosePct)),
    median20SessionPct: med(d20),
    pctAboveIssueAfter20: d20.length ? Math.round((d20.filter((x) => x > 0).length / d20.length) * 100) : null,
    medianNowPct: med(out.map((o) => o.nowPct).filter((x): x is number => x != null)),
    note: "Returns vs issue price, from stored daily closes. NEPSE circuit limits mean new listings often rise in steps over several sessions. Survivorship: only IPOs that list and trade are included.",
    rows: out.sort((a, b) => (a.listing < b.listing ? 1 : -1)),
  });
});

marketRouter.get("/funds", (_req, res) => {
  const funds = all<Record<string, unknown> & { symbol: string }>("SELECT f.*, (SELECT COUNT(*) FROM fund_nav_history h WHERE h.symbol = f.symbol) navPoints FROM fund_navs f ORDER BY f.kind, f.symbol");
  res.json(funds.map((f) => {
    const q = get<{ return1y: number | null }>(`SELECT (SELECT close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1) AS lastp, (SELECT close FROM prices WHERE symbol = ? AND date <= date('now','-365 days') ORDER BY date DESC LIMIT 1) AS yearp`, f.symbol, f.symbol) as unknown as { lastp: number | null; yearp: number | null };
    return { ...f, priceReturn1y: q?.lastp && q?.yearp ? Math.round(((q.lastp - q.yearp) / q.yearp) * 1000) / 10 : null };
  }));
});

marketRouter.get("/compare", (req, res) => {
  const syms = String(req.query.symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{1,12}$/.test(s)).slice(0, 6);
  const days = Math.min(Math.max(Number(req.query.days) || 365, 30), 3650);
  const factors = new Map(M.allFactors().map((f) => [f.symbol, f]));
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  res.json({
    from,
    stocks: syms.map((s) => {
      const c = M.company(s);
      if (!c) return { symbol: s, error: "Unknown symbol" };
      const fa = M.fundamentalsFor(s);
      const b = M.bars(s).bars.filter((x) => x.date >= from);
      const base = b[0]?.close;
      return {
        symbol: s, name: c.name, sector: c.sector, factors: factors.get(s) ?? null,
        period: fa?.latestPeriod ?? null, score: fa?.score ?? null,
        metrics: Object.fromEntries((fa?.metrics ?? []).map((m) => [m.key, { label: m.label, value: m.value, unit: m.unit }])),
        dividend: fa?.dividend ?? null, redFlags: fa?.redFlags ?? [], strengths: fa?.strengths ?? [],
        rebased: base ? b.map((x) => ({ date: x.date, value: Math.round((x.close / base) * 10000) / 100 })) : [],
      };
    }),
  });
});

// ---------- strategy lab: one strategy across many stocks ----------
marketRouter.post("/backtest/universe", (req, res) => {
  const p = z.object({
    strategy: z.enum(STRATEGIES.map((s) => s.id) as [StrategyId, ...StrategyId[]]), params: z.record(z.number()).optional(),
    years: z.number().min(1).max(15).default(5), universe: z.enum(["liquid", "all", "sector", "symbols"]).default("liquid"),
    sector: z.string().optional(), symbols: z.array(SYM).max(100).optional(), stopLossPct: z.number().min(0).max(90).nullable().optional(),
    takeProfitPct: z.number().min(0).max(1000).nullable().optional(), maxHoldDays: z.number().int().min(1).max(2000).nullable().optional(), capital: z.number().positive().default(100000),
  }).parse(req.body);
  let list: string[];
  const factors = M.allFactors();
  if (p.universe === "symbols") list = p.symbols ?? [];
  else if (p.universe === "sector") list = factors.filter((f) => f.sector === p.sector).map((f) => f.symbol);
  else if (p.universe === "liquid") list = factors.filter((f) => (f.avgTurnover20 ?? 0) >= 5_000_000).map((f) => f.symbol);
  else list = factors.map((f) => f.symbol);
  list = list.slice(0, 400);
  const fees = M.fees();
  const results: Record<string, unknown>[] = [];
  const allTrades: { returnPct: number; netPnl: number; holdingDays: number }[] = [];
  let skipped = 0;
  for (const sym of list) {
    const b = M.bars(sym).bars;
    if (b.length < 260) { skipped++; continue; }
    const from = new Date(Date.parse(b[b.length - 1].date) - p.years * 365.25 * 86_400_000).toISOString().slice(0, 10);
    if (b[0].date > from) { skipped++; continue; } // not enough history for the full window: skip for a fair comparison
    const r = runBacktest(b, { strategy: p.strategy, params: p.params, from, capital: p.capital, stopLossPct: p.stopLossPct ?? null, takeProfitPct: p.takeProfitPct ?? null, maxHoldDays: p.maxHoldDays ?? null, fees });
    results.push({ symbol: sym, sector: factors.find((f) => f.symbol === sym)?.sector, ...r.stats, beatBuyHold: r.stats.totalReturnPct > r.stats.buyHoldReturnPct });
    for (const t of r.trades) allTrades.push({ returnPct: t.returnPct, netPnl: t.netPnl, holdingDays: t.holdingDays });
  }
  const med = (v: number[]) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 100) / 100 : null; };
  const mean = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null);
  const wins = allTrades.filter((t) => t.netPnl > 0);
  const grossW = wins.reduce((s, t) => s + t.netPnl, 0), grossL = -allTrades.filter((t) => t.netPnl <= 0).reduce((s, t) => s + t.netPnl, 0);
  const rets = results.map((r) => r.totalReturnPct as number), bh = results.map((r) => r.buyHoldReturnPct as number);
  // Histogram of per-trade returns.
  const buckets = [-50, -20, -10, -5, 0, 5, 10, 20, 50, Infinity];
  const hist = buckets.map((hi, i) => ({ range: i === 0 ? `< ${hi}%` : hi === Infinity ? `> ${buckets[i - 1]}%` : `${buckets[i - 1]}% to ${hi}%`, count: allTrades.filter((t) => t.returnPct < hi && (i === 0 || t.returnPct >= buckets[i - 1])).length }));
  res.json({
    strategy: STRATEGIES.find((s) => s.id === p.strategy), params: { ...STRATEGIES.find((s) => s.id === p.strategy)!.defaults, ...(p.params || {}) }, years: p.years,
    tested: results.length, skippedShortHistory: skipped,
    summary: {
      medianReturnPct: med(rets), medianBuyHoldPct: med(bh), meanReturnPct: mean(rets),
      pctStocksProfitable: results.length ? Math.round((rets.filter((r) => r > 0).length / results.length) * 100) : null,
      pctBeatBuyHold: results.length ? Math.round((results.filter((r) => r.beatBuyHold).length / results.length) * 100) : null,
      totalTrades: allTrades.length, winRatePct: allTrades.length ? Math.round((wins.length / allTrades.length) * 1000) / 10 : null,
      avgTradePct: mean(allTrades.map((t) => t.returnPct)), medianHoldingDays: med(allTrades.map((t) => t.holdingDays)),
      profitFactor: grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : null, medianMaxDrawdownPct: med(results.map((r) => r.maxDrawdownPct as number)),
    },
    histogram: hist,
    results: results.sort((a, b) => (b.totalReturnPct as number) - (a.totalReturnPct as number)),
    caveats: [
      "Each stock is tested separately with the same starting capital; this is not a combined portfolio simulation.",
      "Stocks without price history covering the whole period are skipped, which biases results toward companies that survived (survivorship bias).",
      "Nepal commissions, SEBON fee, DP charge, CGT and 0.2% slippage are included. Circuit limits and liquidity limits are not modelled.",
      "Past performance does not predict future results.",
    ],
  });
});

marketRouter.get("/market/sector-rotation", (_req, res) => {
  const ids = all<{ index_id: number; name: string }>("SELECT DISTINCT index_id, name FROM indices WHERE index_id NOT IN (12, 16, 4, 15)");
  const nepse = all<{ close: number }>("SELECT close FROM indices WHERE index_id = 12 ORDER BY date DESC LIMIT 260").map((r) => r.close);
  const ret = (c: number[], n: number) => (c.length > n ? Math.round(((c[0] - c[n]) / c[n]) * 1000) / 10 : null);
  const rows = ids.map((i) => {
    const c = all<{ close: number }>("SELECT close FROM indices WHERE index_id = ? ORDER BY date DESC LIMIT 260", i.index_id).map((r) => r.close);
    const hi = c.length ? Math.max(...c.slice(0, 250)) : null;
    const r3 = ret(c, 63), n3 = ret(nepse, 63);
    return { indexId: i.index_id, name: i.name, last: c[0] ?? null, w1: ret(c, 5), m1: ret(c, 21), m3: r3, m6: ret(c, 126), y1: ret(c, 250), fromHigh: hi && c[0] ? Math.round(((c[0] - hi) / hi) * 1000) / 10 : null, relative3m: r3 != null && n3 != null ? Math.round((r3 - n3) * 10) / 10 : null };
  });
  res.json({ nepse: { w1: ret(nepse, 5), m1: ret(nepse, 21), m3: ret(nepse, 63), m6: ret(nepse, 126), y1: ret(nepse, 250) }, rows: rows.sort((a, b) => (b.relative3m ?? -999) - (a.relative3m ?? -999)), note: "Returns from stored daily index closes (sessions: 1W = 5, 1M = 21, 3M = 63, 6M = 126, 1Y = 250). Relative 3M = sector index 3M return minus NEPSE 3M return." });
});

marketRouter.get("/stocks/:symbol/peers", (req, res) => {
  const sym = SYM.parse(req.params.symbol);
  const c = M.company(sym);
  if (!c?.sector) return res.json({ sector: null, peers: [] });
  const peers = M.allFactors().filter((f) => f.sector === c.sector);
  const rank = (key: keyof (typeof peers)[number], asc = false) => {
    const sorted = peers.filter((p) => p[key] != null).sort((a, b) => ((a[key] as number) - (b[key] as number)) * (asc ? 1 : -1));
    const i = sorted.findIndex((p) => p.symbol === sym);
    return i >= 0 ? { rank: i + 1, of: sorted.length } : null;
  };
  res.json({
    sector: c.sector,
    ranks: { fundamental: rank("fundamentalScore"), technical: rank("technicalScore"), pe: rank("pe", true), pb: rank("pb", true), roe: rank("roe"), cashYield: rank("cashYield"), return1y: rank("return1y") },
    peers: peers.map((p) => ({ symbol: p.symbol, name: p.name, price: p.price, pe: p.pe, pb: p.pb, roe: p.roe, cashYield: p.cashYield, return1y: p.return1y, fundamentalScore: p.fundamentalScore, technicalScore: p.technicalScore, avgTurnover20: p.avgTurnover20 })),
  });
});

marketRouter.post("/backtest/portfolio", (req, res) => {
  const p = z.object({
    strategy: z.enum(STRATEGIES.map((s) => s.id) as [StrategyId, ...StrategyId[]]), params: z.record(z.number()).optional(),
    years: z.number().min(1).max(15).default(5), universe: z.enum(["liquid", "all", "sector", "symbols"]).default("liquid"), sector: z.string().optional(),
    symbols: z.array(SYM).max(100).optional(), capital: z.number().positive().max(1e10).default(1_000_000), maxPositions: z.number().int().min(1).max(50).default(10),
    stopLossPct: z.number().min(0).max(90).nullable().optional(), takeProfitPct: z.number().min(0).max(1000).nullable().optional(), maxHoldDays: z.number().int().min(1).max(2000).nullable().optional(),
    rankBy: z.enum(["liquidity", "momentum"]).default("liquidity"),
  }).parse(req.body);
  const factors = M.allFactors();
  let list = p.universe === "symbols" ? p.symbols ?? [] : p.universe === "sector" ? factors.filter((f) => f.sector === p.sector).map((f) => f.symbol)
    : p.universe === "liquid" ? factors.filter((f) => (f.avgTurnover20 ?? 0) >= 5_000_000).map((f) => f.symbol) : factors.map((f) => f.symbol);
  list = list.slice(0, 300);
  const series: Record<string, import("../../shared/types.ts").Bar[]> = {};
  for (const s of list) { const b = M.bars(s).bars; if (b.length >= 100) series[s] = b; }
  const idx = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 ORDER BY date");
  const last = idx[idx.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(last) - p.years * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const r = runPortfolioBacktest(series, idx.map((x) => x.date), { ...p, from, fees: M.fees() }, Object.fromEntries(idx.map((x) => [x.date, x.close])));
  res.json({ ...r, universe: Object.keys(series).length, trades: r.trades.slice(-300), tradesTotal: r.trades.length });
});

// Official NRB rates (policy, T-bills, interbank, average deposit/lending), the latest macro report, and market rates used by the advisor.
const RATE_GROUPS: Record<string, string> = { policy: "Policy corridor", tbill: "Treasury bills (weighted average yield)", interbank: "Interbank rate (daily)", deposit: "Average deposit rates (commercial banks)", lending: "Average lending rate", base_rate: "Base rate (commercial banks)", bank_rate: "Bank rate", crr: "Cash reserve ratio", refinance: "Refinance rates", interbank_monthly: "Interbank rate (monthly)" };
marketRouter.get("/economy/rates", (_req, res) => {
  let rows: MON.RateRow[] = [];
  try { rows = all<MON.RateRow>("SELECT * FROM rates WHERE grp IN (" + Object.keys(RATE_GROUPS).map((k) => `'${k}'`).join(",") + ") ORDER BY grp, key"); } catch { /* older market snapshot without rates */ }
  const groups = Object.entries(RATE_GROUPS).map(([grp, title]) => ({ grp, title, rows: rows.filter((r) => r.grp === grp).map((r) => ({ ...r, change: r.prev_value != null ? Math.round((r.value - r.prev_value) * 10000) / 10000 : null })) })).filter((g) => g.rows.length);
  const history = (key: string) => { try { return all<{ as_of: string; value: number }>("SELECT as_of, value FROM rate_history WHERE key = ? ORDER BY as_of", key); } catch { return []; } };
  const fresh = get<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM data_freshness WHERE dataset = 'rates'");
  res.json({ groups, macro: MON.macroLatest(), market: MON.marketRates(), nepse: MON.nepseLongRun(), history: { fd: history("deposit.fixed_deposit"), tbill364: history("tbill.364_days"), policy: history("policy.policy_rate") }, fetchedAt: fresh?.last_success_at ?? null, source: "Nepal Rastra Bank, nrb.org.np (official)" });
});

marketRouter.get("/economy/rate-notices", (_req, res) => {
  // Latest notice per institution (banks and finance companies publish their rates monthly).
  type N = { url: string; symbol: string | null; institution: string; inst_type: string | null; title: string; published: string; image_url: string | null; effective: string | null };
  let rows: N[] = [];
  try { rows = all<N>("SELECT * FROM rate_notices r WHERE published = (SELECT MAX(published) FROM rate_notices x WHERE COALESCE(x.symbol, x.institution) = COALESCE(r.symbol, r.institution)) ORDER BY inst_type, institution"); } catch { /* older market snapshot */ }
  const seen = new Set<string>();
  res.json(rows.filter((r) => { const k = r.symbol ?? r.institution; if (seen.has(k)) return false; seen.add(k); return true; }));
});

marketRouter.get("/economy/debentures", (_req, res) => {
  const today = M.latestTradingDate() ?? new Date().toISOString().slice(0, 10);
  const rows = all<{ symbol: string; name: string; close: number | null; date: string | null; volume: number | null }>(
    "SELECT c.symbol, c.name, (SELECT close FROM prices p WHERE p.symbol = c.symbol ORDER BY date DESC LIMIT 1) close, (SELECT date FROM prices p WHERE p.symbol = c.symbol ORDER BY date DESC LIMIT 1) date, (SELECT SUM(volume) FROM prices p WHERE p.symbol = c.symbol AND date >= date('now','-90 days')) volume FROM companies c WHERE c.sector = 'Corporate Debentures' ORDER BY c.symbol");
  res.json({ asOf: today, rows: rows.map((r) => ({ ...r, ...debentureYield(r.name, r.close, today) })).sort((a, b) => ((b as { approxYtmPct?: number }).approxYtmPct ?? 0) - ((a as { approxYtmPct?: number }).approxYtmPct ?? 0)), note: "Coupon and maturity are read from the listed name; yields are approximate (face value Rs. 1,000, simple YTM). Thinly traded debentures may not be available at the last price." });
});

// ---------- reports, audited results and official filings ----------
const AUDIT_RE = "(lower(title) LIKE '%audited%' OR lower(title) LIKE '%annual report%' OR lower(title) LIKE '%annual financial%' OR lower(title) LIKE '%audit report%')";
marketRouter.get("/stocks/:symbol/filings", (req, res) => {
  const sym = SYM.parse(req.params.symbol);
  const c = get<{ name: string; website: string | null; sector: string | null }>("SELECT name, website, sector FROM companies WHERE symbol = ?", sym);
  if (!c) return res.status(404).json({ error: "Unknown symbol" });
  const audited = all<{ title: string; url: string; published_date: string; category: string }>(`SELECT title, url, published_date, category FROM announcements WHERE symbol = ? AND ${AUDIT_RE} ORDER BY published_date DESC LIMIT 20`, sym);
  const quarterly = all<{ title: string; url: string; published_date: string }>("SELECT title, url, published_date FROM announcements WHERE symbol = ? AND category = 'Quarterly report' ORDER BY published_date DESC LIMIT 8", sym);
  let events: { title: string; url: string; published_date: string; kind: string }[] = [];
  try { events = all("SELECT title, url, published_date, kind FROM company_events WHERE symbol = ? ORDER BY published_date DESC LIMIT 60", sym); } catch { /* older snapshot */ }
  const auditor = events.find((e) => e.kind === "Auditor appointment") ?? null;
  const reports = all<{ period: string; fetched_at: string }>("SELECT period, fetched_at FROM reports WHERE symbol = ? ORDER BY fiscal_year DESC, quarter DESC LIMIT 6", sym);
  const fyNow = (() => { const d = new Date(Date.now() + 345 * 60_000); const bs = d.getUTCFullYear() + 57 - (d.getUTCMonth() < 6 || (d.getUTCMonth() === 6 && d.getUTCDate() < 16) ? 1 : 0); return `${bs - 1}/${String(bs).slice(2)}`; })();
  res.json({
    symbol: sym, name: c.name, sector: c.sector, website: c.website, audited, quarterly, events, latestAuditorNotice: auditor, statementsStored: reports,
    lastCompletedFiscalYear: fyNow,
    where: [
      c.website ? { label: "Company website: full annual report with auditor's report", url: c.website } : null,
      { label: "NEPSE (official exchange filings)", url: "https://www.nepalstock.com.np/company" },
      { label: "SEBON (securities regulator)", url: "https://www.sebon.gov.np" },
      { label: "ShareSansar: announcements and quarterly reports", url: `https://www.sharesansar.com/company/${sym.toLowerCase()}` },
    ].filter(Boolean),
  });
});

marketRouter.get("/reports/audited", (_req, res) => {
  // Latest audited / annual-report announcement per company in the last 18 months, plus coverage.
  const rows = all<{ symbol: string; name: string; sector: string; title: string; url: string; published_date: string }>(`
    SELECT a.symbol, c.name, c.sector, a.title, a.url, a.published_date FROM announcements a JOIN companies c ON c.symbol = a.symbol
    WHERE a.published_date >= date('now','-540 days') AND ${AUDIT_RE.replace(/title/g, "a.title")}
      AND a.published_date = (SELECT MAX(published_date) FROM announcements x WHERE x.symbol = a.symbol AND ${AUDIT_RE.replace(/title/g, "x.title")})
    GROUP BY a.symbol ORDER BY a.published_date DESC`);
  let agm: { symbol: string; title: string; url: string; published_date: string }[] = [];
  try { agm = all(`SELECT e.symbol, e.title, e.url, e.published_date FROM company_events e WHERE e.kind IN ('AGM / SGM','AGM minutes') AND e.published_date >= date('now','-200 days') AND e.published_date = (SELECT MAX(published_date) FROM company_events x WHERE x.symbol = e.symbol AND x.kind IN ('AGM / SGM','AGM minutes')) GROUP BY e.symbol ORDER BY e.published_date DESC`); } catch { /* older snapshot */ }
  const total = get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE status = 'active' AND sector NOT IN ('Promoter Share','Corporate Debentures')")?.n ?? 0;
  const websites = all<{ symbol: string; website: string }>("SELECT symbol, website FROM companies WHERE website IS NOT NULL AND website <> ''");
  res.json({ rows, agm, total, websites: Object.fromEntries(websites.map((w) => [w.symbol, w.website])), note: "Nepali companies publish audited annual results before their AGM, usually within six months after the fiscal year ends (mid-July). The full annual report, with the auditor's report, is on each company's website and filed with NEPSE." });
});

// ---------- Nepal financial market monitor: everything important in one feed, with what it means ----------
const IMPACT: Record<string, string> = {
  "Quarterly report": "Compare EPS, profit growth and (for banks) NPL and capital adequacy with the last quarter and last year; the stock page updates its fundamentals automatically.",
  "Dividend / bonus": "Cash dividends are taxed 5% at source. Bonus shares increase your units but the price adjusts down on book closure; check the book-closure date to qualify.",
  "AGM / SGM": "Shareholder meetings approve dividends, rights and mergers. Book closure for the AGM decides who receives approved dividends.",
  "Annual report": "Full audited statements and the auditor's report; useful to confirm quarterly numbers and spot qualifications or provisions.",
  "Auction": "Unsold right or promoter shares auctioned; usually only matters if you are an existing shareholder or want a block.",
  "Disclosure": "Company notices (rates, management changes, corrections). Interest-rate notices update the Deposit rates comparison.",
  "News": "Market and economy news; check whether it changes the story behind a holding before reacting.",
};
marketRouter.get("/monitor", (req, res) => {
  const since = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const today = M.latestTradingDate() ?? since(0);
  const mine = new Set(all<{ symbol: string }>(`SELECT DISTINCT t.symbol FROM transactions t JOIN portfolios p ON p.id = t.portfolio_id WHERE p.user_id = ?
    UNION SELECT wi.symbol FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id WHERE w.user_id = ?`, req.userId, req.userId).map((r) => r.symbol));
  let rateChanges: Record<string, unknown>[] = [];
  try {
    rateChanges = all<MON.RateRow>("SELECT * FROM rates WHERE grp IN ('policy','tbill','deposit','lending','base_rate','interbank') AND as_of >= ? AND prev_value IS NOT NULL AND prev_value <> value ORDER BY as_of DESC", since(120)).map((r) => ({
      ...r, change: Math.round((r.value - (r.prev_value ?? r.value)) * 100) / 100,
      impact: r.grp === "policy" ? (r.value < (r.prev_value ?? 0) ? "NRB eased policy: deposit and loan rates tend to fall in the following months; generally supportive for shares." : "NRB tightened policy: deposit and loan rates tend to rise; usually a headwind for shares.")
        : r.grp === "tbill" ? (r.value < (r.prev_value ?? 0) ? "Lower T-bill yields signal more spare cash in banks; deposit rates may keep easing." : "Higher T-bill yields signal tighter liquidity; deposit rates may rise.")
        : r.grp === "deposit" ? "Average deposit rates moved; re-check where your fixed deposits and savings sit (Where to Invest → Deposit rates)."
        : r.grp === "lending" || r.grp === "base_rate" ? "Loan rates moved; floating-rate EMIs reprice with the base rate. Consider whether prepaying makes sense." : "Interbank rate moved; a gauge of bank liquidity.",
    }));
  } catch { /* older snapshot */ }
  const issues = all<Record<string, unknown> & { opening_date: string | null; closing_date: string | null; final_date: string | null; listing_date: string | null; status: number | null }>("SELECT * FROM issues WHERE COALESCE(final_date, closing_date, opening_date) >= ? OR status = -2 ORDER BY opening_date DESC LIMIT 40", since(3))
    .map((r) => ({ ...r, state: issueStatus(r, today) })).filter((r) => r.state !== "Closed" && r.state !== "Listed");
  const ann = all<{ symbol: string | null; title: string; url: string; published_date: string; category: string; sector: string | null }>(
    "SELECT a.symbol, a.title, a.url, a.published_date, a.category, c.sector FROM announcements a LEFT JOIN companies c ON c.symbol = a.symbol WHERE a.published_date >= ? ORDER BY a.published_date DESC, a.id DESC LIMIT 400", since(14));
  const byCat: Record<string, { impact: string; items: typeof ann }> = {};
  for (const a of ann) { (byCat[a.category] ??= { impact: IMPACT[a.category] ?? "", items: [] }).items.push(a); }
  const regulatory = ann.filter((a) => /sebon|nepal rastra|nrb|nepse|cdsc|directive|regulat|tax|budget|monetary/i.test(a.title)).slice(0, 15);
  let notices: unknown[] = [];
  try { notices = all("SELECT symbol, institution, inst_type, title, url, published, image_url FROM rate_notices WHERE published >= ? ORDER BY published DESC LIMIT 60", since(35)); } catch { /* older snapshot */ }
  res.json({
    today, market: M.marketSummary(), macro: MON.macroLatest(), rates: MON.marketRates(), rateChanges, issues,
    mine: ann.filter((a) => a.symbol && mine.has(a.symbol)).slice(0, 30), categories: Object.entries(byCat).map(([category, v]) => ({ category, impact: v.impact, count: v.items.length, items: v.items.slice(0, 12) })).sort((a, b) => b.count - a.count),
    regulatory, notices,
    funds: all("SELECT symbol, title, url, published_date FROM announcements WHERE published_date >= ? AND (lower(title) LIKE '%mutual fund%' OR lower(title) LIKE '%nav%' OR lower(title) LIKE '%scheme%') ORDER BY published_date DESC LIMIT 15", since(30)),
  });
});

marketRouter.get("/economy/forex", (_req, res) => {
  const latest = get<{ d: string }>("SELECT MAX(date) d FROM forex")?.d;
  if (!latest) return res.json({ latest: null, rows: [], usd: [] });
  const at = (cur: string, daysBack: number) => get<{ sell: number; unit: number }>("SELECT sell, unit FROM forex WHERE currency = ? AND date <= date(?, ?) ORDER BY date DESC LIMIT 1", cur, latest, `-${daysBack} days`);
  const KEY = ["USD", "EUR", "GBP", "INR", "CNY", "JPY", "AUD", "CAD", "SAR", "QAR", "AED", "MYR", "KRW", "KWD", "BHD"];
  const rows = all<{ currency: string; unit: number; buy: number; sell: number }>("SELECT currency, unit, buy, sell FROM forex WHERE date = ?", latest)
    .filter((r) => KEY.includes(r.currency))
    .sort((a, b) => KEY.indexOf(a.currency) - KEY.indexOf(b.currency))
    .map((r) => {
      const m1 = at(r.currency, 30), y1 = at(r.currency, 365);
      const chg = (o?: { sell: number; unit: number }) => (o?.sell && o.unit === r.unit ? Math.round(((r.sell - o.sell) / o.sell) * 1000) / 10 : null);
      return { ...r, change1m: chg(m1), change1y: chg(y1) };
    });
  const usd = all<{ date: string; sell: number }>("SELECT date, sell FROM forex WHERE currency = 'USD' ORDER BY date");
  res.json({ latest, rows, usd, source: "Nepal Rastra Bank (official rates, NPR per unit shown)", note: "A weaker rupee (higher NPR per USD) raises import costs and remittance value in rupees; the NPR is pegged to the Indian rupee at 1.6." });
});
