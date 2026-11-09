// Long-only backtester (NEPSE has no short selling). Signals are evaluated on a
// session's close and filled at the NEXT session's open, so there is no
// look-ahead. Nepal commissions, SEBON fee, DP charge and CGT are applied.
import type { Bar } from "./types.ts";
import { sma, ema, rsi, macd, atr, supertrend, bollinger } from "./indicators.ts";
import { buyCost, sellCost, cgtRate, DEFAULT_FEES, type FeeConfig } from "./costs.ts";

export type StrategyId = "sma_cross" | "ema_trend" | "rsi_reversion" | "breakout_20" | "macd_cross" | "supertrend" | "bollinger_reversion";

export interface StrategyParams { [k: string]: number }

export interface StrategyDef {
  id: StrategyId;
  name: string;
  style: "trend" | "momentum" | "mean-reversion" | "breakout";
  description: string;
  defaults: StrategyParams;
}

export const STRATEGIES: StrategyDef[] = [
  { id: "sma_cross", name: "SMA crossover", style: "trend", description: "Buy when the fast SMA crosses above the slow SMA; sell when it crosses back below.", defaults: { fast: 20, slow: 50 } },
  { id: "ema_trend", name: "EMA trend filter", style: "trend", description: "Hold while close is above the EMA and the EMA is rising; exit on a close below it.", defaults: { period: 50 } },
  { id: "rsi_reversion", name: "RSI mean reversion", style: "mean-reversion", description: "Buy when RSI drops below the oversold level while price is above the 200-day SMA; sell when RSI rises above the exit level.", defaults: { period: 14, entry: 30, exit: 55, trendFilter: 1 } },
  { id: "breakout_20", name: "20-day breakout with volume", style: "breakout", description: "Buy a close above the prior N-day high on 1.5x average volume; exit on a close below the M-day low.", defaults: { entryN: 20, exitN: 10, volMult: 1.5 } },
  { id: "macd_cross", name: "MACD crossover", style: "momentum", description: "Buy when MACD crosses above its signal line below zero or above; sell on the opposite cross.", defaults: { fast: 12, slow: 26, signal: 9 } },
  { id: "supertrend", name: "Supertrend", style: "trend", description: "Buy when Supertrend flips up, sell when it flips down.", defaults: { period: 10, mult: 3 } },
  { id: "bollinger_reversion", name: "Bollinger band reversion", style: "mean-reversion", description: "Buy a close below the lower band; sell at the middle band.", defaults: { period: 20, mult: 2 } },
];

export interface BacktestOptions {
  strategy: StrategyId;
  params?: StrategyParams;
  capital?: number;
  stopLossPct?: number | null; // e.g. 8 = exit if price falls 8% below entry (checked on lows)
  takeProfitPct?: number | null;
  maxHoldDays?: number | null;
  slippagePct?: number; // applied against you on each fill
  fees?: FeeConfig;
  from?: string;
  to?: string;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  qty: number;
  holdingDays: number;
  grossPnl: number;
  costs: number;
  tax: number;
  netPnl: number;
  returnPct: number;
  reason: string;
}

export interface BacktestResult {
  strategy: StrategyDef;
  params: StrategyParams;
  period: { from: string; to: string; sessions: number };
  trades: Trade[];
  equity: { date: string; value: number }[];
  stats: {
    startCapital: number;
    endCapital: number;
    totalReturnPct: number;
    cagrPct: number | null;
    buyHoldReturnPct: number;
    trades: number;
    winRatePct: number | null;
    avgTradePct: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    profitFactor: number | null;
    maxDrawdownPct: number;
    exposurePct: number;
    totalCosts: number;
    totalTax: number;
  };
  caveats: string[];
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Returns, per bar, desired position after that bar closes: 1 = be long, 0 = flat, null = no opinion (keep). */
export function signalSeries(bars: Bar[], id: StrategyId, p: StrategyParams): (0 | 1 | null)[] {
  const c = bars.map((b) => b.close);
  const out: (0 | 1 | null)[] = new Array(bars.length).fill(null);
  const cross = (a: (number | null)[], b: (number | null)[], i: number) =>
    a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null
      ? (a[i - 1] as number) <= (b[i - 1] as number) && (a[i] as number) > (b[i] as number) ? 1 : (a[i - 1] as number) >= (b[i - 1] as number) && (a[i] as number) < (b[i] as number) ? -1 : 0
      : 0;
  switch (id) {
    case "sma_cross": {
      const f = sma(c, p.fast), s = sma(c, p.slow);
      for (let i = 1; i < bars.length; i++) { const x = cross(f, s, i); if (x === 1) out[i] = 1; if (x === -1) out[i] = 0; }
      break;
    }
    case "ema_trend": {
      const e = ema(c, p.period);
      for (let i = 1; i < bars.length; i++) {
        if (e[i] == null || e[i - 1] == null) continue;
        out[i] = c[i] > (e[i] as number) && (e[i] as number) > (e[i - 1] as number) ? 1 : c[i] < (e[i] as number) ? 0 : null;
      }
      break;
    }
    case "rsi_reversion": {
      const r = rsi(c, p.period), t = sma(c, 200);
      for (let i = 0; i < bars.length; i++) {
        if (r[i] == null) continue;
        const trendOk = !p.trendFilter || (t[i] != null && c[i] > (t[i] as number));
        if ((r[i] as number) < p.entry && trendOk) out[i] = 1;
        else if ((r[i] as number) > p.exit) out[i] = 0;
      }
      break;
    }
    case "breakout_20": {
      const v = sma(bars.map((b) => b.volume), 20);
      for (let i = Math.max(p.entryN, p.exitN) + 1; i < bars.length; i++) {
        const hh = Math.max(...bars.slice(i - p.entryN, i).map((b) => b.high));
        const ll = Math.min(...bars.slice(i - p.exitN, i).map((b) => b.low));
        if (c[i] > hh && v[i - 1] != null && bars[i].volume >= p.volMult * (v[i - 1] as number)) out[i] = 1;
        else if (c[i] < ll) out[i] = 0;
      }
      break;
    }
    case "macd_cross": {
      const m = macd(c, p.fast, p.slow, p.signal);
      for (let i = 1; i < bars.length; i++) { const x = cross(m.macd, m.signal, i); if (x === 1) out[i] = 1; if (x === -1) out[i] = 0; }
      break;
    }
    case "supertrend": {
      const st = supertrend(bars, p.period, p.mult);
      for (let i = 1; i < bars.length; i++) {
        if (st.direction[i] === 1 && st.direction[i - 1] === -1) out[i] = 1;
        if (st.direction[i] === -1 && st.direction[i - 1] === 1) out[i] = 0;
      }
      break;
    }
    case "bollinger_reversion": {
      const bb = bollinger(c, p.period, p.mult);
      for (let i = 0; i < bars.length; i++) {
        if (bb.lower[i] == null) continue;
        if (c[i] < (bb.lower[i] as number)) out[i] = 1;
        else if (c[i] >= (bb.middle[i] as number)) out[i] = 0;
      }
      break;
    }
  }
  return out;
}

export function runBacktest(allBars: Bar[], opts: BacktestOptions): BacktestResult {
  const def = STRATEGIES.find((s) => s.id === opts.strategy);
  if (!def) throw new Error(`Unknown strategy ${opts.strategy}`);
  const params = { ...def.defaults, ...(opts.params || {}) };
  const fees = opts.fees || DEFAULT_FEES;
  const capital0 = opts.capital ?? 100_000;
  const slip = (opts.slippagePct ?? 0.2) / 100;
  // Compute signals on full history so indicators are warmed up, then trade only inside the window.
  const sig = signalSeries(allBars, opts.strategy, params);
  const startIdx = Math.max(1, opts.from ? allBars.findIndex((b) => b.date >= opts.from!) : 1);
  let endIdx = opts.to ? allBars.findIndex((b) => b.date > opts.to!) - 1 : allBars.length - 1;
  if (endIdx < 0) endIdx = allBars.length - 1;

  let cash = capital0;
  let qty = 0;
  let entryPrice = 0;
  let entryDate = "";
  let entryCost = 0;
  let entryIdx = 0;
  let pending: "buy" | "sell" | null = null;
  let pendingReason = "";
  const trades: Trade[] = [];
  const equity: { date: string; value: number }[] = [];
  let inMarketBars = 0;
  let totalCosts = 0;
  let totalTax = 0;

  const closeTrade = (i: number, rawPrice: number, reason: string) => {
    const px = rawPrice * (1 - slip);
    const sc = sellCost(qty, px, fees);
    const gross = sc.net - entryCost;
    const hd = daysBetween(entryDate, allBars[i].date);
    const tax = gross > 0 ? gross * cgtRate(hd, "individual", fees, allBars[i].date) : 0;
    cash += sc.net - tax;
    totalCosts += sc.total;
    totalTax += tax;
    const netPnl = gross - tax;
    trades.push({
      entryDate, entryPrice: round(entryPrice), exitDate: allBars[i].date, exitPrice: round(px), qty, holdingDays: hd,
      grossPnl: round(qty * (px - entryPrice)), costs: round(entryCost - qty * entryPrice + sc.total), tax: round(tax),
      netPnl: round(netPnl), returnPct: round((netPnl / entryCost) * 100), reason,
    });
    qty = 0;
  };

  for (let i = startIdx; i <= endIdx; i++) {
    const b = allBars[i];
    // 1) Execute orders decided at the previous close, at today's open.
    if (pending === "buy" && qty === 0) {
      const px = b.open * (1 + slip);
      // Size so that amount + charges fits in cash (charges are < 1%).
      let q = Math.floor(cash / (px * 1.006));
      while (q > 0 && buyCost(q, px, fees).net > cash) q--;
      if (q > 0) {
        const bc = buyCost(q, px, fees);
        cash -= bc.net;
        totalCosts += bc.total;
        qty = q; entryPrice = px; entryDate = b.date; entryCost = bc.net; entryIdx = i;
      }
    } else if (pending === "sell" && qty > 0) {
      closeTrade(i, b.open, pendingReason);
    }
    pending = null;

    // 2) Intraday protective exits (stop first: conservative when both are touched).
    if (qty > 0) {
      if (opts.stopLossPct && b.low <= entryPrice * (1 - opts.stopLossPct / 100)) {
        closeTrade(i, Math.min(b.open, entryPrice * (1 - opts.stopLossPct / 100)), "Stop-loss");
      } else if (opts.takeProfitPct && b.high >= entryPrice * (1 + opts.takeProfitPct / 100)) {
        closeTrade(i, Math.max(b.open, entryPrice * (1 + opts.takeProfitPct / 100)), "Take-profit");
      }
    }

    // 3) Decide tomorrow's action from today's close.
    const s = sig[i];
    if (qty > 0) {
      if (s === 0) { pending = "sell"; pendingReason = "Exit signal"; }
      else if (opts.maxHoldDays && i - entryIdx >= opts.maxHoldDays) { pending = "sell"; pendingReason = "Max holding period"; }
    } else if (s === 1) pending = "buy";

    if (qty > 0) inMarketBars++;
    equity.push({ date: b.date, value: round(cash + qty * b.close) });
  }
  if (qty > 0) closeTrade(endIdx, allBars[endIdx].close, "End of test (marked to close)");
  if (equity.length) equity[equity.length - 1].value = round(cash);

  const sessions = endIdx - startIdx + 1;
  const endCapital = cash;
  const years = sessions > 1 ? daysBetween(allBars[startIdx].date, allBars[endIdx].date) / 365.25 : 0;
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e.value); mdd = Math.max(mdd, (peak - e.value) / peak); }
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const sumW = wins.reduce((s, t) => s + t.netPnl, 0);
  const sumL = -losses.reduce((s, t) => s + t.netPnl, 0);
  const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  return {
    strategy: def,
    params,
    period: { from: allBars[startIdx]?.date, to: allBars[endIdx]?.date, sessions },
    trades,
    equity,
    stats: {
      startCapital: capital0,
      endCapital: round(endCapital),
      totalReturnPct: round(((endCapital - capital0) / capital0) * 100),
      cagrPct: years >= 1 ? round((Math.pow(endCapital / capital0, 1 / years) - 1) * 100) : null,
      buyHoldReturnPct: round(((allBars[endIdx].close - allBars[startIdx].open) / allBars[startIdx].open) * 100),
      trades: trades.length,
      winRatePct: trades.length ? round((wins.length / trades.length) * 100) : null,
      avgTradePct: avg(trades.map((t) => t.returnPct)),
      avgWinPct: avg(wins.map((t) => t.returnPct)),
      avgLossPct: avg(losses.map((t) => t.returnPct)),
      profitFactor: sumL > 0 ? round(sumW / sumL) : wins.length ? null : null,
      maxDrawdownPct: round(mdd * 100),
      exposurePct: sessions ? round((inMarketBars / sessions) * 100) : 0,
      totalCosts: round(totalCosts),
      totalTax: round(totalTax),
    },
    caveats: [
      "Prices are adjusted for bonus and right issues only where the expected price gap is found in the data; any unadjusted corporate action can trigger false signals.",
      "Fills assume you could trade at the next session's open plus slippage; thinly traded NEPSE stocks may not allow that.",
      "Circuit limits (10% daily band) and T+2 settlement are not modelled.",
      "Past results do not predict future returns. Few trades means the statistics are unreliable.",
    ],
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
export { atr };

// ---------- Portfolio-level backtest (shared capital) ----------

export interface PortfolioBacktestOptions {
  strategy: StrategyId;
  params?: StrategyParams;
  capital?: number;
  maxPositions?: number; // simultaneous holdings
  from?: string;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
  maxHoldDays?: number | null;
  slippagePct?: number;
  fees?: FeeConfig;
  rankBy?: "liquidity" | "momentum";
}

export interface PortfolioBacktestResult {
  strategy: StrategyDef;
  params: StrategyParams;
  period: { from: string; to: string; sessions: number };
  equity: { date: string; value: number; cash: number; positions: number; benchmark: number | null }[];
  trades: (Trade & { symbol: string })[];
  stats: {
    startCapital: number; endCapital: number; totalReturnPct: number; cagrPct: number | null; benchmarkReturnPct: number | null;
    maxDrawdownPct: number; trades: number; winRatePct: number | null; avgTradePct: number | null; profitFactor: number | null;
    avgPositions: number; exposurePct: number; totalCosts: number; totalTax: number; skippedSignals: number;
  };
  caveats: string[];
}

export function runPortfolioBacktest(series: Record<string, Bar[]>, dates: string[], opts: PortfolioBacktestOptions, benchmark?: Record<string, number>): PortfolioBacktestResult {
  const def = STRATEGIES.find((s) => s.id === opts.strategy);
  if (!def) throw new Error(`Unknown strategy ${opts.strategy}`);
  const params = { ...def.defaults, ...(opts.params || {}) };
  const fees = opts.fees || DEFAULT_FEES;
  const capital0 = opts.capital ?? 1_000_000;
  const maxPos = Math.max(1, opts.maxPositions ?? 10);
  const slip = (opts.slippagePct ?? 0.2) / 100;
  // Per-symbol lookups by date.
  const idx: Record<string, Map<string, number>> = {};
  const sig: Record<string, (0 | 1 | null)[]> = {};
  for (const [s, b] of Object.entries(series)) {
    idx[s] = new Map(b.map((x, i) => [x.date, i]));
    sig[s] = signalSeries(b, opts.strategy, params);
  }
  const days = dates.filter((d) => !opts.from || d >= opts.from);
  let cash = capital0;
  const pos = new Map<string, { qty: number; entryPrice: number; entryDate: string; entryCost: number; entryDayIdx: number }>();
  const lastClose: Record<string, number> = {};
  const pendingBuys: string[] = [];
  const pendingSells = new Map<string, string>();
  const trades: (Trade & { symbol: string })[] = [];
  const equity: PortfolioBacktestResult["equity"] = [];
  let totalCosts = 0, totalTax = 0, skipped = 0, posDays = 0, inMarket = 0;
  let bench0: number | null = null;

  const close = (s: string, dayIdx: number, date: string, raw: number, reason: string) => {
    const p = pos.get(s)!;
    const px = raw * (1 - slip);
    const sc = sellCost(p.qty, px, fees);
    const gross = sc.net - p.entryCost;
    const hd = daysBetween(p.entryDate, date);
    const tax = gross > 0 ? gross * cgtRate(hd, "individual", fees, date) : 0;
    cash += sc.net - tax;
    totalCosts += sc.total; totalTax += tax;
    trades.push({ symbol: s, entryDate: p.entryDate, entryPrice: round(p.entryPrice), exitDate: date, exitPrice: round(px), qty: p.qty, holdingDays: hd, grossPnl: round(p.qty * (px - p.entryPrice)), costs: round(p.entryCost - p.qty * p.entryPrice + sc.total), tax: round(tax), netPnl: round(gross - tax), returnPct: round(((gross - tax) / p.entryCost) * 100), reason });
    pos.delete(s);
    void dayIdx;
  };
  const equityNow = () => cash + [...pos.entries()].reduce((t, [s, p]) => t + p.qty * (lastClose[s] ?? p.entryPrice), 0);
  const avgTurnover = (s: string, i: number) => { const b = series[s]; let t = 0, n = 0; for (let j = Math.max(0, i - 19); j <= i; j++) { t += b[j].amount ?? b[j].close * b[j].volume; n++; } return n ? t / n : 0; };
  const mom = (s: string, i: number) => { const b = series[s]; return i >= 63 ? b[i].close / b[i - 63].close - 1 : 0; };

  days.forEach((d, dayIdx) => {
    // 1) Execute orders at today's open: sells first, then buys with equal slices of equity.
    for (const [s, reason] of pendingSells) {
      const i = idx[s].get(d);
      if (i != null && pos.has(s)) close(s, dayIdx, d, series[s][i].open, reason);
      else if (pos.has(s)) continue; // not traded today: try again tomorrow
      pendingSells.delete(s);
    }
    const slot = equityNow() / maxPos;
    for (const s of pendingBuys.splice(0)) {
      if (pos.size >= maxPos || pos.has(s)) { skipped++; continue; }
      const i = idx[s].get(d);
      if (i == null) { skipped++; continue; }
      const px = series[s][i].open * (1 + slip);
      const budget = Math.min(slot, cash);
      let q = Math.floor(budget / (px * 1.006));
      while (q > 0 && buyCost(q, px, fees).net > budget) q--;
      if (q <= 0) { skipped++; continue; }
      const bc = buyCost(q, px, fees);
      cash -= bc.net; totalCosts += bc.total;
      pos.set(s, { qty: q, entryPrice: px, entryDate: d, entryCost: bc.net, entryDayIdx: dayIdx });
    }
    // 2) Intraday stops / targets, then decide tomorrow's actions from today's close.
    const candidates: { s: string; score: number }[] = [];
    for (const s of Object.keys(series)) {
      const i = idx[s].get(d);
      if (i == null) continue;
      const b = series[s][i];
      lastClose[s] = b.close;
      const p = pos.get(s);
      if (p) {
        if (opts.stopLossPct && b.low <= p.entryPrice * (1 - opts.stopLossPct / 100)) { close(s, dayIdx, d, Math.min(b.open, p.entryPrice * (1 - opts.stopLossPct / 100)), "Stop-loss"); continue; }
        if (opts.takeProfitPct && b.high >= p.entryPrice * (1 + opts.takeProfitPct / 100)) { close(s, dayIdx, d, Math.max(b.open, p.entryPrice * (1 + opts.takeProfitPct / 100)), "Take-profit"); continue; }
        if (sig[s][i] === 0) pendingSells.set(s, "Exit signal");
        else if (opts.maxHoldDays && dayIdx - p.entryDayIdx >= opts.maxHoldDays) pendingSells.set(s, "Max holding period");
      } else if (sig[s][i] === 1) {
        candidates.push({ s, score: opts.rankBy === "momentum" ? mom(s, i) : avgTurnover(s, i) });
      }
    }
    const free = maxPos - pos.size + [...pendingSells.keys()].filter((s) => pos.has(s)).length;
    candidates.sort((a, b) => b.score - a.score);
    skipped += Math.max(0, candidates.length - free);
    pendingBuys.push(...candidates.slice(0, Math.max(0, free)).map((c) => c.s));
    const v = equityNow();
    posDays += pos.size; if (pos.size) inMarket++;
    const bm = benchmark?.[d];
    if (bm != null && bench0 == null) bench0 = bm;
    equity.push({ date: d, value: round(v), cash: round(cash), positions: pos.size, benchmark: bm != null && bench0 ? round((bm / bench0) * capital0) : null });
  });
  const lastDay = days[days.length - 1];
  for (const s of [...pos.keys()]) close(s, days.length - 1, lastDay, lastClose[s], "End of test (marked to close)");
  if (equity.length) equity[equity.length - 1].value = round(cash);

  let peak = -Infinity, mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e.value); mdd = Math.max(mdd, (peak - e.value) / peak); }
  const wins = trades.filter((t) => t.netPnl > 0);
  const sw = wins.reduce((s, t) => s + t.netPnl, 0), sl = -trades.filter((t) => t.netPnl <= 0).reduce((s, t) => s + t.netPnl, 0);
  const years = days.length > 1 ? daysBetween(days[0], lastDay) / 365.25 : 0;
  const lastBench = [...equity].reverse().find((e) => e.benchmark != null)?.benchmark ?? null;
  return {
    strategy: def, params, period: { from: days[0], to: lastDay, sessions: days.length }, equity, trades,
    stats: {
      startCapital: capital0, endCapital: round(cash), totalReturnPct: round(((cash - capital0) / capital0) * 100),
      cagrPct: years >= 1 ? round((Math.pow(cash / capital0, 1 / years) - 1) * 100) : null,
      benchmarkReturnPct: lastBench != null ? round(((lastBench - capital0) / capital0) * 100) : null,
      maxDrawdownPct: round(mdd * 100), trades: trades.length, winRatePct: trades.length ? round((wins.length / trades.length) * 100) : null,
      avgTradePct: trades.length ? round(trades.reduce((s, t) => s + t.returnPct, 0) / trades.length) : null, profitFactor: sl > 0 ? round(sw / sl) : null,
      avgPositions: days.length ? round(posDays / days.length) : 0, exposurePct: days.length ? round((inMarket / days.length) * 100) : 0,
      totalCosts: round(totalCosts), totalTax: round(totalTax), skippedSignals: skipped,
    },
    caveats: [
      "One pot of capital is shared: each new position gets an equal slice of current equity (capital / max positions). When more stocks signal than free slots, the most liquid (or strongest momentum) are chosen.",
      "Signals at close, fills at the next session's open with slippage; Nepal commission, SEBON fee, DP charge and CGT included.",
      "Liquidity and circuit limits are not modelled; small stocks may not fill at these prices. Survivorship bias applies (only currently listed stocks).",
      "Past results do not predict future returns.",
    ],
  };
}
