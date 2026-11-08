// Tools the AI analyst can call. Every tool reads stored data or runs a
// deterministic engine; the model never sees anything we did not compute.
import { all, get } from "../db.ts";
import * as M from "../lib/market.ts";
import { RANK_STRATEGIES, rankStocks, type StrategyKey } from "../../shared/ranking.ts";
import { runBacktest, STRATEGIES, type StrategyId } from "../../shared/backtest.ts";
import { portfolioData } from "../lib/portfolioService.ts";
import { searchDocuments } from "../lib/documents.ts";
import { planGoal, allocateLumpSum } from "../../shared/planner.ts";
import { positionSize } from "../../shared/portfolio.ts";
import { roundTrip } from "../../shared/costs.ts";

export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOL_DEFS: ToolDef[] = [
  { name: "search_stocks", description: "Find NEPSE companies by symbol or name fragment. Use this when the user names a company and you are unsure of the ticker.", input_schema: obj({ query: { type: "string" } }, ["query"]) },
  { name: "get_market_overview", description: "Latest NEPSE market summary: indices, breadth, turnover, top gainers/losers, sector performance, 52-week highs/lows, market trend. Includes the trading date.", input_schema: obj({}) },
  { name: "get_stock_analysis", description: "Full deterministic analysis for one stock: latest price and date, technical snapshot (trend, RSI, MACD, ADX, moving averages, returns), support/resistance levels with reasons, detected chart patterns, rule-based trade setups (entry/stop/targets/RR), fundamental ratios computed from the latest quarterly statements with the sector-specific score, red flags, dividends, and data freshness.", input_schema: obj({ symbol: { type: "string" } }, ["symbol"]) },
  { name: "get_financial_statements", description: "Raw quarterly balance sheet, profit & loss and key metrics line items (Rs. in '000) for every stored period of a company. Use for detailed questions about financial statements or comparing quarters.", input_schema: obj({ symbol: { type: "string" } }, ["symbol"]) },
  { name: "compare_stocks", description: "Side-by-side key metrics (price, valuation, profitability, asset quality, dividends, technical score, returns) for 2-6 stocks.", input_schema: obj({ symbols: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 } }, ["symbols"]) },
  { name: "rank_stocks", description: `Rank all eligible NEPSE stocks with a strategy-specific, transparent scoring model. Strategies: ${RANK_STRATEGIES.map((s) => `${s.key} (${s.name})`).join(", ")}. Returns scores, factor contributions, and how many stocks were excluded by filters.`, input_schema: obj({ strategy: { type: "string", enum: RANK_STRATEGIES.map((s) => s.key) }, limit: { type: "integer", minimum: 1, maximum: 30 }, sector: { type: "string", description: "Optional sector filter, e.g. 'Hydropower', 'Commercial Bank'" } }, ["strategy"]) },
  { name: "screen_stocks", description: "Filter stocks by numeric criteria. All filters optional. Returns matching rows with key factors.", input_schema: obj({
    sector: { type: "string" }, min_roe: { type: "number" }, max_pe: { type: "number" }, max_pb: { type: "number" }, min_cash_yield: { type: "number" },
    min_years_dividend_of_5: { type: "integer" }, trend: { type: "string", enum: ["uptrend", "downtrend", "sideways"] }, rsi_below: { type: "number" }, rsi_above: { type: "number" },
    max_distance_to_support_pct: { type: "number", description: "Price within this % above its nearest support" }, min_avg_turnover: { type: "number", description: "Rs. average daily turnover (20 sessions)" },
    min_profit_growth_yoy: { type: "number" }, has_setup: { type: "boolean" }, sort_by: { type: "string", enum: ["fundamentalScore", "technicalScore", "roe", "pe", "pb", "cashYield", "return3m", "setupQuality"] }, limit: { type: "integer", minimum: 1, maximum: 40 },
  }) },
  { name: "get_trade_setups", description: "All currently active rule-based trade setups across liquid NEPSE stocks (breakouts, pullbacks, momentum, oversold bounces, trend continuation, breakdown/exit warnings), sorted by quality.", input_schema: obj({ side: { type: "string", enum: ["buy", "sell", "any"] }, limit: { type: "integer", minimum: 1, maximum: 30 } }) },
  { name: "run_backtest", description: `Backtest a rule-based strategy on one stock's price history with Nepal commissions, SEBON fee, DP charge, CGT and slippage. Strategies: ${STRATEGIES.map((s) => `${s.id} (${s.name})`).join(", ")}.`, input_schema: obj({ symbol: { type: "string" }, strategy: { type: "string", enum: STRATEGIES.map((s) => s.id) }, years: { type: "number", minimum: 1, maximum: 20 }, stop_loss_pct: { type: "number" } }, ["symbol", "strategy"]) },
  { name: "get_portfolio", description: "The user's portfolio(s): holdings with WACC, market value, unrealised/realised P&L, dividends, allocation, sector exposure, health score and issues, plus each holding's fundamental and technical scores.", input_schema: obj({ portfolio_id: { type: "integer", description: "Omit for all portfolios combined summary list" } }) },
  { name: "get_announcements", description: "Company announcements and market news headlines stored from public sources, newest first. Filter by symbol, category or recent days.", input_schema: obj({ symbol: { type: "string" }, category: { type: "string" }, days: { type: "integer" }, limit: { type: "integer", maximum: 50 } }) },
  { name: "search_documents", description: "Search the text of uploaded PDF reports (annual/quarterly reports, auditor reports). Returns matching passages with document title, period and page number for citation.", input_schema: obj({ query: { type: "string" }, symbol: { type: "string" }, limit: { type: "integer", maximum: 12 } }, ["query"]) },
  { name: "get_sector_stats", description: "Sector medians (P/E, P/B, ROE, cash yield, technical score) and the stocks in a sector, for relative valuation.", input_schema: obj({ sector: { type: "string" } }, ["sector"]) },
  { name: "get_public_issues", description: "IPO, FPO, right share and mutual fund issues: open now, upcoming/approved, recently listed, with listing performance vs issue price where price history exists. Also returns historical IPO listing statistics.", input_schema: obj({ type: { type: "string", enum: ["IPO", "FPO", "Right share", "IPO (local quota)", "IPO (foreign-employed quota)", "Mutual fund"] }, only_active: { type: "boolean" } }) },
  { name: "get_mutual_funds", description: "Listed close-ended mutual funds: fund size, weekly and monthly NAV, market price, premium/discount to NAV, maturity, 1-year price return.", input_schema: obj({}) },
  { name: "get_portfolio_performance", description: "A portfolio's performance over time (time-weighted return vs NEPSE index, max drawdown, value vs net invested) and its tax summary by Nepali fiscal year (realised gains/losses, CGT, dividends, dividend tax).", input_schema: obj({ portfolio_id: { type: "integer" } }, ["portfolio_id"]) },
  { name: "plan_rebalance", description: "Trades needed to move a portfolio to target weights (percent per symbol), with Nepal charges and estimated CGT, optionally adding new cash. Weights not summing to 100 leave the rest in cash.", input_schema: obj({ portfolio_id: { type: "integer" }, targets: { type: "object", description: "symbol -> target percent" }, cash_to_add: { type: "number" } }, ["portfolio_id", "targets"]) },
  { name: "run_portfolio_backtest", description: "Backtest a strategy as one shared-capital account across many stocks (max simultaneous positions, equal slices), vs the NEPSE index, with Nepal costs.", input_schema: obj({ strategy: { type: "string", enum: STRATEGIES.map((s) => s.id) }, years: { type: "number" }, max_positions: { type: "integer" }, universe: { type: "string", enum: ["liquid", "all", "sector"] }, sector: { type: "string" }, stop_loss_pct: { type: "number" } }, ["strategy"]) },
  { name: "get_exchange_rates", description: "Official NRB exchange rates (NPR per unit) for major and remittance currencies, with 1-month and 1-year changes.", input_schema: obj({}) },
  { name: "get_wealth_profile", description: "The user's saved financial profile and goals (income, expenses, savings, risk tolerance, goals with target dates). Use for personal financial planning questions.", input_schema: obj({}) },
  { name: "calculate", description: "Deterministic calculators: goal plan (with inflation and scenarios), lump-sum allocation, position size, round-trip trade cost with Nepal fees/CGT.", input_schema: obj({
    kind: { type: "string", enum: ["goal", "allocation", "position_size", "round_trip"] },
    params: { type: "object", description: "goal: {costToday, years, inflationPct, currentSaved, monthlyCapacity}; allocation: {amount, emergencyFundGap, highInterestDebt, horizonYears, risk: low|medium|high, nearTermGoalAmount, nearTermGoalYears}; position_size: {capital, riskPct, entry, stop}; round_trip: {qty, buyPrice, sellPrice, holdingDays}" },
  }, ["kind", "params"]) },
];

const round = (x: unknown) => (typeof x === "number" ? Math.round(x * 100) / 100 : x);

function compactAnalysis(symbol: string) {
  const a = M.analyzeStock(symbol);
  if (!a.company) return { error: `Unknown symbol ${symbol}` };
  const fa = a.fundamentals;
  return {
    symbol: a.symbol, name: a.company.name, sector: a.company.sector, listedShares: a.company.listed_shares,
    price: { lastClose: a.lastBar?.close ?? null, date: a.lastBar?.date ?? null, quote: a.quote ? { ltp: a.quote.ltp, changePct: a.quote.change_pct, high52: a.quote.high52, low52: a.quote.low52, turnover: a.quote.turnover } : null },
    bonusAdjustments: a.adjustments.map((x) => `${x.exDate}: ${x.bonusPct}% bonus, prices before divided by ${(1 / x.factor).toFixed(3)}`),
    technical: a.technical && { ...a.technical, scoreFactors: a.technical.scoreFactors.map((f) => `${f.factor} (${f.points > 0 ? "+" : ""}${f.points})`) },
    supports: a.levels?.supports.slice(0, 4).map((l) => ({ price: l.price, zone: [l.low, l.high], strength: l.strength, score: l.score, reactions: l.reactions, volumeConfirmed: l.volumeConfirmed, why: l.why, invalidation: l.invalidation })),
    resistances: a.levels?.resistances.slice(0, 4).map((l) => ({ price: l.price, zone: [l.low, l.high], strength: l.strength, score: l.score, reactions: l.reactions, volumeConfirmed: l.volumeConfirmed, why: l.why, invalidation: l.invalidation })),
    dynamicLevels: a.levels?.dynamic, zones: a.levels?.zones.slice(0, 4), levelMethod: a.levels?.method,
    patterns: a.patterns.map((p) => ({ name: p.name, direction: p.direction, status: p.status, keyLevel: p.keyLevel, target: p.target, invalidation: p.invalidation, description: p.description })),
    setups: a.setups.map((s) => ({ type: s.type, side: s.side, horizon: s.horizon, entry: [s.entryLow, s.entryHigh], stopLoss: s.stopLoss, targets: s.targets, riskReward: s.riskReward, riskPct: s.riskPct, quality: s.quality, volume: s.volume.note, reasoning: s.reasoning, invalidation: s.invalidation, netOfCosts: s.netOfCosts })),
    fundamentals: fa && {
      latestPeriod: fa.latestPeriod, sectorModel: fa.score.model, overallScore: fa.score.overall,
      components: fa.score.components.map((c) => ({ name: c.name, score: c.score, drivers: c.drivers })),
      metrics: fa.metrics.map((m) => ({ label: m.label, value: round(m.value), unit: m.unit, basis: m.basis, reported: m.reported, formula: m.formula, note: m.note })),
      growth: fa.growth, dividend: { ...fa.dividend, history: fa.dividend.history.slice(0, 8) }, redFlags: fa.redFlags, strengths: fa.strengths, dataNotes: fa.dataNotes,
    },
    dataFreshness: a.dataFreshness,
    sources: ["Prices: nepse-data (GitHub, MIT) + ShareSansar daily prices", "Statements, dividends, profile: ShareSansar company pages (company-published quarterly reports)"],
  };
}

function screen(p: Record<string, unknown>) {
  let rows = M.allFactors();
  const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : null);
  if (p.sector) rows = rows.filter((r) => r.sector.toLowerCase().includes(String(p.sector).toLowerCase()));
  if (n("min_roe") != null) rows = rows.filter((r) => (r.roe ?? -1e9) >= n("min_roe")!);
  if (n("max_pe") != null) rows = rows.filter((r) => r.pe != null && r.pe <= n("max_pe")!);
  if (n("max_pb") != null) rows = rows.filter((r) => r.pb != null && r.pb <= n("max_pb")!);
  if (n("min_cash_yield") != null) rows = rows.filter((r) => (r.cashYield ?? 0) >= n("min_cash_yield")!);
  if (n("min_years_dividend_of_5") != null) rows = rows.filter((r) => (r.yearsPaid5 ?? 0) >= n("min_years_dividend_of_5")!);
  if (p.trend) rows = rows.filter((r) => r.trend === p.trend);
  if (n("rsi_below") != null) rows = rows.filter((r) => r.rsi != null && r.rsi < n("rsi_below")!);
  if (n("rsi_above") != null) rows = rows.filter((r) => r.rsi != null && r.rsi > n("rsi_above")!);
  if (n("min_avg_turnover") != null) rows = rows.filter((r) => (r.avgTurnover20 ?? 0) >= n("min_avg_turnover")!);
  if (n("min_profit_growth_yoy") != null) rows = rows.filter((r) => (r.profitGrowthYoY ?? -1e9) >= n("min_profit_growth_yoy")!);
  if (p.has_setup) rows = rows.filter((r) => r.setupQuality != null);
  let withSupport: { symbol: string; dist: number | null }[] | null = null;
  if (n("max_distance_to_support_pct") != null) {
    const lim = n("max_distance_to_support_pct")!;
    withSupport = rows.map((r) => {
      const a = M.analyzeStock(r.symbol);
      const s = a.levels?.supports[0];
      return { symbol: r.symbol, dist: s ? Math.round(-s.distancePct * 100) / 100 : null, level: s?.price, strength: s?.strength };
    }).filter((x) => x.dist != null && x.dist <= lim);
    const keep = new Set(withSupport.map((x) => x.symbol));
    rows = rows.filter((r) => keep.has(r.symbol));
  }
  const sortKey = (p.sort_by as string) || "fundamentalScore";
  const asc = sortKey === "pe" || sortKey === "pb";
  rows = [...rows].sort((a, b) => {
    const av = (a as unknown as Record<string, number | null>)[sortKey], bv = (b as unknown as Record<string, number | null>)[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    return asc ? av - bv : bv - av;
  });
  const limit = n("limit") ?? 20;
  return {
    matches: rows.length,
    rows: rows.slice(0, limit).map((r) => ({ ...r, nearestSupport: withSupport?.find((w) => w.symbol === r.symbol) })),
    asOf: M.latestTradingDate(),
  };
}

export async function executeTool(name: string, input: Record<string, unknown>, userId: number): Promise<unknown> {
  switch (name) {
    case "search_stocks": {
      const q = `%${String(input.query || "").toUpperCase()}%`;
      return all("SELECT symbol, name, sector FROM companies WHERE UPPER(symbol) LIKE ? OR UPPER(name) LIKE ? ORDER BY (UPPER(symbol) = ?) DESC LIMIT 15", q, q, String(input.query || "").toUpperCase());
    }
    case "get_market_overview": {
      const m = M.marketSummary();
      return { ...m, gainers: m.gainers.slice(0, 8), losers: m.losers.slice(0, 8), turnover: m.turnover.slice(0, 8), volume: m.volume.slice(0, 5), highs52: m.highs52.slice(0, 10), lows52: m.lows52.slice(0, 10) };
    }
    case "get_stock_analysis": return compactAnalysis(String(input.symbol).toUpperCase());
    case "get_financial_statements": {
      const reps = M.reportsFor(String(input.symbol).toUpperCase());
      if (!reps.length) return { error: "No statements stored for this company yet." };
      return reps.map((r) => ({ period: r.period, source: r.source, fetchedAt: r.fetchedAt, units: "Rs. '000 unless a ratio/per-share", items: r.items.map((i) => `${i.statement}: ${i.label} = ${i.value}`) }));
    }
    case "compare_stocks": {
      const syms = (input.symbols as string[]).map((s) => s.toUpperCase());
      const f = new Map(M.allFactors().map((r) => [r.symbol, r]));
      return syms.map((s) => {
        const fa = M.fundamentalsFor(s);
        return { symbol: s, factors: f.get(s) ?? null, keyMetrics: fa?.metrics.map((m) => `${m.label}: ${round(m.value)}${m.unit === "%" ? "%" : m.unit === "x" ? "x" : ""}`), period: fa?.latestPeriod, redFlags: fa?.redFlags, strengths: fa?.strengths };
      });
    }
    case "rank_stocks": {
      const strat = RANK_STRATEGIES.find((s) => s.key === (input.strategy as StrategyKey));
      if (!strat) return { error: "Unknown strategy" };
      let rows = M.allFactors();
      if (input.sector) rows = rows.filter((r) => r.sector.toLowerCase().includes(String(input.sector).toLowerCase()));
      const r = rankStocks(rows, strat, undefined, Number(input.limit) || 10);
      return {
        strategy: { name: strat.name, horizon: strat.horizon, kind: strat.kind, description: strat.description, weights: strat.weights.map((w) => `${w.label}: ${w.weight}`), filters: strat.filters.map((f) => f.label) },
        universe: rows.length, excludedOrInsufficientData: r.excluded, asOf: M.latestTradingDate(),
        ranked: r.ranked.map((x) => ({ rank: x.rank, symbol: x.symbol, name: x.name, sector: x.sector, score: x.score, dataCoveragePct: x.coverage, contributions: x.contributions, price: x.factors.price })),
      };
    }
    case "screen_stocks": return screen(input);
    case "get_trade_setups": {
      const side = (input.side as string) || "any";
      const s = M.allSetups(200).filter((x) => side === "any" || x.side === side).slice(0, Number(input.limit) || 15);
      return { asOf: M.latestTradingDate(), setups: s.map((x) => ({ symbol: x.symbol, name: x.name, sector: x.sector, type: x.type, side: x.side, price: x.price, entry: [x.entryLow, x.entryHigh], stop: x.stopLoss, targets: x.targets, rr: x.riskReward, quality: x.quality, volume: x.volume.note, reasoning: x.reasoning, invalidation: x.invalidation })) };
    }
    case "run_backtest": {
      const sym = String(input.symbol).toUpperCase();
      const b = M.bars(sym).bars;
      if (b.length < 100) return { error: "Not enough price history" };
      const years = Number(input.years) || 5;
      const from = new Date(Date.parse(b[b.length - 1].date) - years * 365.25 * 86_400_000).toISOString().slice(0, 10);
      const r = runBacktest(b, { strategy: input.strategy as StrategyId, from, stopLossPct: (input.stop_loss_pct as number) ?? null, fees: M.fees() });
      return { symbol: sym, strategy: r.strategy.name, params: r.params, period: r.period, stats: r.stats, lastTrades: r.trades.slice(-8), caveats: r.caveats };
    }
    case "get_portfolio": return portfolioData(userId, input.portfolio_id as number | undefined);
    case "get_announcements": {
      const where: string[] = [];
      const params: unknown[] = [];
      if (input.symbol) { where.push("symbol = ?"); params.push(String(input.symbol).toUpperCase()); }
      if (input.category) { where.push("category LIKE ?"); params.push(`%${input.category}%`); }
      if (input.days) { where.push("published_date >= ?"); params.push(new Date(Date.now() - Number(input.days) * 86_400_000).toISOString().slice(0, 10)); }
      return all(`SELECT symbol, title, url, published_date, category, source FROM announcements ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY published_date DESC, id DESC LIMIT ?`, ...params, Number(input.limit) || 20);
    }
    case "search_documents": return searchDocuments(userId, String(input.query), input.symbol as string | undefined, Number(input.limit) || 6);
    case "get_sector_stats": {
      const rows = M.allFactors().filter((r) => r.sector.toLowerCase().includes(String(input.sector).toLowerCase()));
      const med = (k: keyof (typeof rows)[number]) => {
        const v = rows.map((r) => r[k] as number | null).filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
        return v.length ? round(v[Math.floor(v.length / 2)]) : null;
      };
      return { sector: input.sector, stocks: rows.length, medians: { pe: med("pe"), pb: med("pb"), roe: med("roe"), cashYield: med("cashYield"), technicalScore: med("technicalScore"), fundamentalScore: med("fundamentalScore") }, members: rows.map((r) => ({ symbol: r.symbol, name: r.name, price: r.price, pe: r.pe, pb: r.pb, roe: r.roe, fundamentalScore: r.fundamentalScore, technicalScore: r.technicalScore })) };
    }
    case "get_public_issues": {
      const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
      const type = (input.type as string) || "IPO";
      let rows = all<Record<string, unknown> & { opening_date: string; closing_date: string | null; final_date: string | null; status: number | null; listing_date: string | null }>("SELECT symbol, company, issue_type, ratio, units, price, opening_date, closing_date, final_date, listing_date, issue_manager, status FROM issues WHERE issue_type = ? ORDER BY (opening_date = '') DESC, opening_date DESC LIMIT 80", type);
      if (input.only_active) rows = rows.filter((r) => r.status === -2 || !r.opening_date || (r.final_date || r.closing_date || "") >= today || (r.listing_date && r.listing_date >= new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)));
      return { today, issues: rows.slice(0, 40), note: "status -2 = approved/upcoming (dates not yet announced). Use the Opportunities page for listing-performance statistics." };
    }
    case "get_mutual_funds": return all("SELECT symbol, name, kind, fund_size, weekly_nav, weekly_date, monthly_nav, monthly_date, ltp, ltp_date, premium_pct, maturity_date FROM fund_navs ORDER BY kind, premium_pct");
    case "get_portfolio_performance": {
      const own = get("SELECT id FROM portfolios WHERE id = ? AND user_id = ?", Number(input.portfolio_id), userId);
      if (!own) return { error: "Portfolio not found" };
      const { performanceFor, taxReportFor } = await import("../lib/portfolioService.ts");
      return { performance: performanceFor(Number(input.portfolio_id)), tax: taxReportFor(Number(input.portfolio_id)) };
    }
    case "plan_rebalance": {
      const own = get("SELECT id FROM portfolios WHERE id = ? AND user_id = ?", Number(input.portfolio_id), userId);
      if (!own) return { error: "Portfolio not found" };
      const { portfolioSummary } = await import("../lib/portfolioService.ts");
      const { rebalancePlan } = await import("../../shared/portfolio.ts");
      const d = portfolioSummary(Number(input.portfolio_id));
      const targets = Object.fromEntries(Object.entries((input.targets || {}) as Record<string, number>).map(([k, v]) => [k.toUpperCase(), Number(v)]));
      const prices: Record<string, number | null> = {};
      for (const sym of new Set([...Object.keys(targets), ...d.summary.holdings.map((h) => h.symbol)])) prices[sym] = (M.quote(sym)?.close as number) ?? null;
      return rebalancePlan(d.summary.holdings, targets, prices, Number(input.cash_to_add) || 0, M.fees());
    }
    case "run_portfolio_backtest": {
      const { runPortfolioBacktest } = await import("../../shared/backtest.ts");
      const factors = M.allFactors();
      const list = (input.universe === "sector" ? factors.filter((f) => f.sector === input.sector) : input.universe === "all" ? factors : factors.filter((f) => (f.avgTurnover20 ?? 0) >= 5_000_000)).map((f) => f.symbol).slice(0, 300);
      const series: Record<string, import("../../shared/types.ts").Bar[]> = {};
      for (const sym of list) { const b = M.bars(sym).bars; if (b.length >= 100) series[sym] = b; }
      const idx = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 ORDER BY date");
      const last = idx[idx.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
      const from = new Date(Date.parse(last) - (Number(input.years) || 5) * 365.25 * 86_400_000).toISOString().slice(0, 10);
      const r = runPortfolioBacktest(series, idx.map((x) => x.date), { strategy: input.strategy as StrategyId, from, maxPositions: Number(input.max_positions) || 10, stopLossPct: (input.stop_loss_pct as number) ?? null, fees: M.fees() }, Object.fromEntries(idx.map((x) => [x.date, x.close])));
      return { strategy: r.strategy.name, params: r.params, period: r.period, universe: Object.keys(series).length, stats: r.stats, caveats: r.caveats };
    }
    case "get_exchange_rates": {
      const latest = get<{ d: string }>("SELECT MAX(date) d FROM forex")?.d;
      return { date: latest, source: "Nepal Rastra Bank", rates: all("SELECT currency, unit, buy, sell FROM forex WHERE date = ? AND currency IN ('USD','EUR','GBP','INR','CNY','JPY','AUD','SAR','QAR','AED','MYR','KRW')", latest) };
    }
    case "get_wealth_profile": {
      const { readVault } = await import("../lib/vault.ts");
      return { profile: readVault(userId, "profile")[0]?.data ?? null, goals: readVault(userId, "goal").map((g) => g.data) };
    }
    case "calculate": {
      const p = (input.params || {}) as Record<string, number & string>;
      switch (input.kind) {
        case "goal": return planGoal({ name: "Goal", costToday: p.costToday, years: p.years, inflationPct: p.inflationPct ?? 6, currentSaved: p.currentSaved ?? 0, monthlyCapacity: p.monthlyCapacity ?? 0 });
        case "allocation": return allocateLumpSum({ amount: p.amount, emergencyFundGap: p.emergencyFundGap ?? 0, highInterestDebt: p.highInterestDebt ?? 0, horizonYears: p.horizonYears ?? 5, risk: (p.risk as "low") ?? "medium", nearTermGoalAmount: p.nearTermGoalAmount ?? 0, nearTermGoalYears: p.nearTermGoalYears ?? 10 });
        case "position_size": return positionSize(p.capital, p.riskPct, p.entry, p.stop, M.fees());
        case "round_trip": return roundTrip(p.qty, p.buyPrice, p.sellPrice, p.holdingDays ?? 30, M.fees());
      }
      return { error: "Unknown calculator" };
    }
  }
  return { error: `Unknown tool ${name}` };
}

export function dataContext() {
  const f = all<{ dataset: string; as_of: string | null; last_success_at: string | null }>("SELECT dataset, as_of, last_success_at FROM data_freshness");
  const reports = get<{ n: number; c: number }>("SELECT COUNT(*) n, COUNT(DISTINCT symbol) c FROM reports");
  return { freshness: f, reportsStored: reports, latestTradingDate: M.latestTradingDate() };
}
