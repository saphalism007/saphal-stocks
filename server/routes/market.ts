import { Router } from "express";
import { z } from "zod";
import { all, get } from "../db.ts";
import * as M from "../lib/market.ts";
import { RANK_STRATEGIES, rankStocks } from "../../shared/ranking.ts";
import { runBacktest, STRATEGIES, type StrategyId } from "../../shared/backtest.ts";
import { patternTrackRecord } from "../../shared/patterns.ts";
import { syncCompanyDetail, syncHistory } from "../ingest/jobs.ts";
import { buildStockReport } from "../ai/offline.ts";

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
  res.json({ symbol: sym, bars: b.bars, adjustments: b.adjustments, skipped: b.skippedAdjustments });
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
