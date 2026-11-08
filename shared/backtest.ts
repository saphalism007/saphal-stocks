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
function signalSeries(bars: Bar[], id: StrategyId, p: StrategyParams): (0 | 1 | null)[] {
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
    const tax = gross > 0 ? gross * cgtRate(hd, "individual", fees) : 0;
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
