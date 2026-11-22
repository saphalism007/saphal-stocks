import { all, get } from "../db.ts";
import { computeHoldings, portfolioHealth, portfolioTimeline, nepaliFiscalYear, type Transaction } from "../../shared/portfolio.ts";
import { getSetting } from "../db.ts";
import * as M from "./market.ts";
import * as TR from "./trading.ts";
import { evaluate, type Opportunity } from "../../shared/opportunities.ts";
import { positionPlan, reentryPlan } from "../../shared/positionPlan.ts";
import { researchFor, researchBoard, marketIntel } from "./research.ts";

export function txsFor(portfolioId: number): Transaction[] {
  return all<{ id: number; symbol: string; type: Transaction["type"]; date: string; quantity: number; price: number; commission: number | null; other_charges: number | null; tax: number | null; notes: string | null }>(
    "SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY date, id", portfolioId,
  ).map((t) => ({ id: t.id, symbol: t.symbol, type: t.type, date: t.date, quantity: t.quantity, price: t.price, commission: t.commission, otherCharges: t.other_charges, tax: t.tax, notes: t.notes }));
}

export function latestPrices(symbols: string[]) {
  const out: Record<string, number | null> = {};
  for (const s of symbols) {
    const q = get<{ close: number }>("SELECT close FROM quotes WHERE symbol = ?", s) ?? get<{ close: number }>("SELECT close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1", s);
    out[s] = q?.close ?? null;
  }
  return out;
}

export function portfolioSummary(portfolioId: number) {
  const txs = txsFor(portfolioId);
  const prices = latestPrices([...new Set(txs.map((t) => t.symbol))]);
  const summary = computeHoldings(txs, prices, M.fees());
  const syms = summary.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const sectors: Record<string, string> = {};
  for (const s of syms) sectors[s] = (get<{ sector: string }>("SELECT sector FROM companies WHERE symbol = ?", s)?.sector) || "Unknown";
  const factors = new Map(M.allFactors().map((f) => [f.symbol, f]));
  const extras: Record<string, { fundamentalScore: number | null; technicalScore: number | null; volatility: number | null }> = {};
  for (const s of syms) { const f = factors.get(s); extras[s] = { fundamentalScore: f?.fundamentalScore ?? null, technicalScore: f?.technicalScore ?? null, volatility: f?.volatility ?? null }; }
  const health = syms.length ? portfolioHealth(summary, sectors, extras) : null;
  // Today's move for each holding (live during the session), for "today's gain" and the day change column.
  const day: Record<string, { date: string; close: number; prevClose: number | null; changePct: number | null; live: boolean }> = {};
  for (const s of syms) {
    const q = get<{ date: string; close: number; prev_close: number | null; change_pct: number | null; source: string | null }>("SELECT date, close, prev_close, change_pct, source FROM quotes WHERE symbol = ?", s);
    if (q?.close) day[s] = { date: q.date, close: q.close, prevClose: q.prev_close, changePct: q.change_pct, live: q.source === "live" };
  }
  return { summary, health, sectors, extras, day, priceDate: M.latestTradingDate(), transactions: txs };
}

export function portfolioData(userId: number, portfolioId?: number) {
  const ports = all<{ id: number; name: string; kind: string; strategy: string | null }>("SELECT id, name, kind, strategy FROM portfolios WHERE user_id = ? ORDER BY id", userId);
  if (!ports.length) return { portfolios: [], note: "The user has not created any portfolio yet." };
  const target = portfolioId ? ports.filter((p) => p.id === portfolioId) : ports;
  return {
    priceDate: M.latestTradingDate(),
    portfolios: target.map((p) => {
      const d = portfolioSummary(p.id);
      return {
        id: p.id, name: p.name, kind: p.kind, strategy: p.strategy,
        totals: { invested: d.summary.invested, marketValue: d.summary.marketValue, unrealizedPnl: d.summary.unrealizedPnl, realizedPnl: d.summary.realizedPnl, dividends: d.summary.dividends, totalReturnPct: d.summary.totalReturnPct },
        holdings: d.summary.holdings.filter((h) => h.quantity > 0).map((h) => ({ symbol: h.symbol, sector: d.sectors[h.symbol], qty: h.quantity, wacc: Math.round(h.wacc * 100) / 100, lastPrice: h.lastPrice, marketValue: h.marketValue, unrealizedPct: h.unrealizedPct != null ? Math.round(h.unrealizedPct * 10) / 10 : null, weightPct: d.summary.marketValue ? Math.round(((h.marketValue ?? h.costBasis) / d.summary.marketValue) * 1000) / 10 : null, firstBuy: h.firstBuyDate, ...d.extras[h.symbol] })),
        health: d.health, missingPrices: d.summary.missingPrices,
      };
    }),
  };
}

export function performanceFor(portfolioId: number) {
  const txs = txsFor(portfolioId);
  if (!txs.length) return null;
  const start = txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date);
  const prices: Record<string, [string, number][]> = {};
  for (const s of new Set(txs.map((t) => t.symbol))) prices[s] = all<{ date: string; close: number }>("SELECT date, close FROM prices WHERE symbol = ? AND date >= date(?, '-30 days') ORDER BY date", s, start).map((r) => [r.date, r.close]);
  const idx = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND date >= ? ORDER BY date", start);
  const pts = portfolioTimeline(txs, prices, idx.map((r) => r.date), Object.fromEntries(idx.map((r) => [r.date, r.close])), M.fees());
  const last = pts[pts.length - 1];
  if (!last) return null;
  let peak = 0, mdd = 0;
  for (const p of pts) { peak = Math.max(peak, p.twrIndex); mdd = Math.max(mdd, (peak - p.twrIndex) / peak); }
  return { from: pts[0].date, to: last.date, value: last.value, netInvested: last.netInvested, twrPct: Math.round((last.twrIndex - 100) * 100) / 100, nepsePct: last.benchmark != null ? Math.round((last.benchmark - 100) * 100) / 100 : null, maxDrawdownPct: Math.round(mdd * 10000) / 100 };
}

export function taxReportFor(portfolioId: number) {
  const fyStart = getSetting("fyStart", "07-16");
  const s = computeHoldings(txsFor(portfolioId), {}, M.fees());
  const by: Record<string, { gains: number; losses: number; cgt: number; dividends: number; dividendTax: number }> = {};
  for (const e of s.realizedEvents) { const k = nepaliFiscalYear(e.date, fyStart); by[k] ??= { gains: 0, losses: 0, cgt: 0, dividends: 0, dividendTax: 0 }; if (e.gain >= 0) by[k].gains += e.gain; else by[k].losses -= e.gain; by[k].cgt += e.tax; }
  for (const e of s.dividendEvents) { const k = nepaliFiscalYear(e.date, fyStart); by[k] ??= { gains: 0, losses: 0, cgt: 0, dividends: 0, dividendTax: 0 }; by[k].dividends += e.gross; by[k].dividendTax += e.tax; }
  return { fyStart, byFiscalYear: by };
}

/** The smart view of a portfolio: a plan for each holding, buy-back views for stocks sold, and their latest news. */
export function portfolioInsights(portfolioId: number) {
  const txs = txsFor(portfolioId);
  const syms = [...new Set(txs.map((t) => t.symbol))];
  const quotes = new Map(syms.map((s) => [s, get<{ close: number; date: string; source: string | null }>("SELECT close, date, source FROM quotes WHERE symbol = ?", s)]));
  const prices: Record<string, number | null> = Object.fromEntries(syms.map((s) => [s, quotes.get(s)?.close ?? null]));
  const fees = M.fees();
  const summary = computeHoldings(txs, prices, fees);
  const oppRows = TR.withLive(TR.opportunities().rows);
  const opps = new Map(oppRows.map((o) => [o.symbol, o]));
  const factors = new Map(M.allFactors().map((x) => [x.symbol, x]));
  const latest = M.latestTradingDate() ?? "";
  const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const oppFor = (sym: string) => {
    const hit = opps.get(sym);
    if (hit) return hit;
    try {
      const c = M.company(sym);
      const o: Opportunity = evaluate({ symbol: sym, name: c?.name || sym, sector: c?.sector || "", bars: M.bars(sym, { limit: 420, official: true }).bars, fundamentals: TR.fundamentalInput(sym), avgTurnover20: factors.get(sym)?.avgTurnover20 ?? null, latestMarketDate: latest, fees });
      return TR.withLive([o])[0];
    } catch { return null; }
  };
  const atPurchase = (sym: string, date: string | null) => {
    if (!date) return null;
    try {
      const r = get<{ date: string; action: string; entry_low: number | null; entry_high: number | null; stop: number | null; t1: number | null }>(
        "SELECT date, action, entry_low, entry_high, stop, t1 FROM signal_log WHERE symbol = ? AND date <= ? AND date >= date(?, '-7 days') ORDER BY date DESC LIMIT 1", sym, date, date);
      return r ? { date: r.date, action: r.action, entryLow: r.entry_low, entryHigh: r.entry_high, stop: r.stop, t1: r.t1 } : null;
    } catch { return null; }
  };
  const open = summary.holdings.filter((h) => h.quantity > 0);
  const port = get<{ strategy: string | null; kind: string; name: string }>("SELECT strategy, kind, name FROM portfolios WHERE id = ?", portfolioId);
  const style: "trade" | "invest" = /swing|experimental|trad/i.test(port?.strategy ?? "") ? "trade" : "invest";
  const upcomingDividend = (sym: string) => {
    try {
      const d = get<{ fiscal_year: string; cash_pct: number | null; bonus_pct: number | null; bookclose_date: string }>("SELECT fiscal_year, cash_pct, bonus_pct, bookclose_date FROM dividends WHERE symbol = ? AND bookclose_date >= ? ORDER BY bookclose_date LIMIT 1", sym, today);
      return d ? { fiscalYear: d.fiscal_year, cashPct: d.cash_pct, bonusPct: d.bonus_pct, bookCloseDate: d.bookclose_date } : null;
    } catch { return null; }
  };
  const plans = open.map((h) => {
    const c = M.company(h.symbol), q = quotes.get(h.symbol);
    return positionPlan({ style, dividend: upcomingDividend(h.symbol), faceValue: c?.paid_up_value ?? null, high52: get<{ high52: number | null }>("SELECT high52 FROM quotes WHERE symbol = ?", h.symbol)?.high52 ?? null,
      holding: h, name: c?.name || h.symbol, sector: c?.sector || "", opp: oppFor(h.symbol), price: q?.close ?? null, priceDate: q?.date ?? null, live: q?.source === "live",
      fa: TR.fundamentalInput(h.symbol), technicalScore: factors.get(h.symbol)?.technicalScore ?? null, atPurchase: atPurchase(h.symbol, h.lots[0]?.date ?? null), today, fees,
    });
  });
  // The full research verdict for each holding; a plan never says "add" when the research says reduce, sell or avoid.
  const totalValue = plans.reduce((t, p) => t + (p.price ?? p.wacc) * p.quantity, 0) || 1;
  for (const p of plans as (typeof plans[number] & { research?: unknown; weightPct?: number; strength?: number | null })[]) {
    p.weightPct = Math.round((((p.price ?? p.wacc) * p.quantity) / totalValue) * 1000) / 10;
    let r: ReturnType<typeof researchFor> = null;
    try { r = researchFor(p.symbol); } catch { /* keep the plan without it */ }
    if (!r) continue;
    p.research = { decision: r.decision, conviction: r.conviction, headline: r.headline, agree: r.agree, horizon: r.horizon, whyNot: r.whyNot, changeMind: r.changeMind, plan: r.plan,
      pillars: r.pillars.map((x) => ({ key: x.key, title: x.title, verdict: x.verdict, summary: x.summary, score: x.score })),
      smart: r.smart ? { phase: r.smart.phase, phaseWhy: r.smart.phaseWhy, risk: r.smart.risk, riskWhy: r.smart.riskWhy.slice(0, 3), brokerRead: r.smart.brokerRead, sessions: r.smart.sessions, topBuyers: r.smart.topBuyers.slice(0, 3), topSellers: r.smart.topSellers.slice(0, 3), metrics: { top3NetBuyPct: r.smart.metrics.top3NetBuyPct, top3NetSellPct: r.smart.metrics.top3NetSellPct, crossPct: r.smart.metrics.crossPct } } : null };
    // Holding strength 0-100: how many of the areas studied support keeping it.
    p.strength = r.agree.known ? Math.round(50 + ((r.agree.positive - r.agree.negative) / r.agree.known) * 50) : null;
    if (p.action === "ADD" && ["SELL", "REDUCE", "AVOID"].includes(r.decision)) { p.action = "HOLD"; p.tone = "blue"; p.headline = `Do not add: the research says ${r.decision.toLowerCase()} (${r.headline})`; p.steps = p.steps.filter((x) => !x.startsWith("Add only")); }
    if ((p.action === "HOLD" || p.action === "ADD") && r.decision === "SELL") { p.action = "REDUCE"; p.tone = "down"; p.headline = `Research says sell: ${r.headline}`; }
    // Smart money: do not add into distribution or operator activity, and warn while holding.
    const sm = r.smart;
    if (sm && (sm.risk === "High" || sm.phase === "Distribution" || sm.brokerRead === "Distribution")) {
      const why = sm.risk === "High" ? "signs of operator activity (sharp run-up, limit-up days, crossing or thin trading)" : sm.phase === "Distribution" ? "price and volume show distribution (large holders selling into strength)" : "big brokers have been net sellers in recent sessions";
      if (p.action === "ADD") { p.action = "HOLD"; p.tone = "blue"; p.headline = `Do not add yet: ${why}.`; p.steps = p.steps.filter((x) => !x.startsWith("Add only")); }
      p.steps = [`Smart money warning: ${why}. If you are in profit, consider booking part of it and keep the stop.`, ...p.steps];
    } else if (sm && sm.brokerRead === "Accumulation" && (p.action === "HOLD" || p.action === "ADD")) {
      p.steps = [...p.steps, "Big brokers have been net buyers in recent sessions, which supports holding."];
    }
  }
  const order: Record<string, number> = { SELL: 0, REVIEW: 1, REDUCE: 2, "BOOK PROFIT": 3, ADD: 4, HOLD: 5 };
  plans.sort((a, b) => order[a.action] - order[b.action] || (b.price ?? 0) * b.quantity - (a.price ?? 0) * a.quantity);
  const closed = summary.holdings.filter((h) => h.quantity === 0).map((h) => {
    const sell = [...txs].reverse().find((t) => t.symbol === h.symbol && t.type === "sell");
    const c = M.company(h.symbol);
    return reentryPlan(h.symbol, c?.name || h.symbol, sell ? { date: sell.date, price: sell.price } : null, oppFor(h.symbol), quotes.get(h.symbol)?.close ?? null);
  });
  const watch = [...open.map((h) => h.symbol), ...closed.map((c) => c.symbol)];
  const news = watch.length ? all<{ symbol: string | null; title: string; url: string | null; published_date: string | null; category: string | null; source: string | null }>(
    `SELECT symbol, title, url, published_date, category, source FROM announcements WHERE symbol IN (${watch.map(() => "?").join(",")}) AND COALESCE(published_date, substr(fetched_at, 1, 10)) >= date('now', '-45 days')
     ORDER BY COALESCE(published_date, fetched_at) DESC LIMIT 60`, ...watch) : [];
  const counts = plans.reduce<Record<string, number>>((m, p) => { m[p.action] = (m[p.action] ?? 0) + 1; return m; }, {});
  return { asOf: latest, signalsAsOf: oppRows[0]?.priceDate ?? null, plans, closed, news, counts, overview: overviewOf(plans as never, style, port?.strategy ?? null) };
}

type PlanX = ReturnType<typeof positionPlan> & { weightPct?: number; strength?: number | null; research?: { decision: string; smart: { phase: string; risk: string; brokerRead: string } | null } };
/** The whole portfolio at a glance: money at risk, what to do today, dates, smart money warnings, concentration, the economy for your sectors, and ideas. */
function overviewOf(plans: PlanX[], style: "trade" | "invest", strategy: string | null) {
  const r0 = (x: number) => Math.round(x);
  const value = plans.reduce((t, p) => t + (p.price ?? p.wacc) * p.quantity, 0);
  const now = plans.reduce((t, p) => t + (p.scenarios[0]?.receive ?? 0), 0);
  const atStops = plans.reduce((t, p) => t + (p.scenarios.find((x) => x.label.startsWith("If the stop"))?.receive ?? p.scenarios[0]?.receive ?? 0), 0);
  const atTargets = plans.reduce((t, p) => t + (p.scenarios.find((x) => x.label.startsWith("At the first"))?.receive ?? p.scenarios[0]?.receive ?? 0), 0);
  const profitNow = plans.reduce((t, p) => t + (p.scenarios[0]?.profit ?? 0), 0);
  const strengths = plans.map((p) => p.strength).filter((x): x is number => x != null);
  const todo = plans.filter((p) => p.action !== "HOLD" || p.steps[0]?.startsWith("Smart money")).slice(0, 8).map((p) => ({ symbol: p.symbol, action: p.action, text: p.steps[0] ?? p.headline }));
  const events = plans.flatMap((p) => p.timing.filter((t) => t.date).map((t) => ({ symbol: p.symbol, ...t }))).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).slice(0, 10);
  const smart = plans.filter((p) => p.research?.smart && (p.research.smart.risk === "High" || p.research.smart.phase === "Distribution" || p.research.smart.brokerRead === "Distribution" || p.research.smart.brokerRead === "Accumulation"))
    .map((p) => ({ symbol: p.symbol, good: p.research!.smart!.brokerRead === "Accumulation" && p.research!.smart!.risk !== "High" && p.research!.smart!.phase !== "Distribution", text: p.research!.smart!.risk === "High" ? "possible operator activity" : p.research!.smart!.phase === "Distribution" ? "distribution in price and volume" : p.research!.smart!.brokerRead === "Distribution" ? "big brokers net selling" : "big brokers net buying" }));
  const warnings: string[] = [];
  for (const p of plans) if ((p.weightPct ?? 0) > 25) warnings.push(`${p.symbol} is ${p.weightPct}% of this portfolio. More than 25% in one stock means one bad result can hurt the whole portfolio.`);
  const bySector = new Map<string, number>();
  for (const p of plans) bySector.set(p.sector || "Other", (bySector.get(p.sector || "Other") ?? 0) + (p.weightPct ?? 0));
  for (const [sec, w] of bySector) if (w > 40 && plans.length > 1) warnings.push(`${Math.round(w)}% is in ${sec}. One policy change (for example from NRB or the budget) would move most of your money at once.`);
  const losers = plans.filter((p) => (p.pnlPct ?? 0) <= -15);
  if (losers.length) warnings.push(`${losers.map((p) => p.symbol).join(", ")} ${losers.length > 1 ? "are" : "is"} down 15% or more. Check each stop: holding losers hoping to break even is the most common way NEPSE investors lose money.`);
  let economy: { verdict: string; summary: string; notes: { sector: string; note: string }[] } | null = null;
  let ideas: { symbol: string; decision: string; headline: string; newSector: boolean }[] = [];
  try {
    const intel = marketIntel();
    const held = new Set(plans.map((p) => p.sector));
    economy = { verdict: intel.macro.verdict, summary: intel.macro.summary, notes: [...held].flatMap((sec) => (intel.macro.sectorNotes[sec] ?? []).slice(0, 1).map((note) => ({ sector: sec, note }))) };
    const board = researchBoard();
    const mine = new Set(plans.map((p) => p.symbol));
    ideas = Object.entries(board).filter(([sym, v]) => !mine.has(sym) && ["STRONG BUY", "BUY", "ACCUMULATE"].includes(v.decision) && v.smart?.risk !== "High")
      .map(([sym, v]) => ({ symbol: sym, decision: v.decision, headline: v.headline, newSector: !held.has(M.company(sym)?.sector ?? "") }))
      .sort((a, b) => Number(b.newSector) - Number(a.newSector) || (a.decision === "ACCUMULATE" ? 1 : 0) - (b.decision === "ACCUMULATE" ? 1 : 0)).slice(0, 6);
  } catch { /* market data still loading */ }
  return {
    style, strategy, value: r0(value), netIfSoldNow: r0(now), profitNow: r0(profitNow),
    atStops: r0(atStops), riskToStops: r0(Math.max(0, now - atStops)), riskToStopsPct: now ? Math.round(((now - atStops) / now) * 1000) / 10 : null,
    atTargets: r0(atTargets), gainToTargets: r0(Math.max(0, atTargets - now)), odds: atStops < now ? Math.round(((atTargets - now) / (now - atStops)) * 100) / 100 : null, withTargets: plans.filter((p) => p.scenarios.some((x) => x.label.startsWith("At the first"))).length, holdings: plans.length,
    strength: strengths.length ? Math.round(strengths.reduce((t, x) => t + x, 0) / strengths.length) : null,
    todo, events, smart, warnings, economy, ideas,
  };
}
