// Short-term swing list: stocks to buy and hold for about 1-2 weeks (up to 10 trading sessions).
// Each stock is scored on closing prices only, with fixed rules decided before testing:
//  gates: liquid (Rs. 50 lakh+ a day), above a rising 50-day average with the 20-day above the 50-day, not a pump
//         (under 30% in 20 sessions, fewer than 3 limit-up days), RSI 45-72;
//  points: trend, healthy momentum, rising volume, money flowing in, a breakout or pullback setup, a strong close.
// The plan for each: buy range, stop (recent low or 1.5 ATR, at most 8% away), two targets, and a 10-session time stop.
// The same rules are replayed on the past year exactly as a person would have traded them (buy at the next open,
// half sold at target 1 with the stop moved to entry, the rest at target 2, stop or day 10), after broker commission,
// SEBON fee, DP charges and capital gains tax, so you can see how the list has really done. Nothing is promised.
import type { Bar } from "./types.ts";
import { buyCost, sellCost, cgtRate, DEFAULT_FEES, type FeeConfig } from "./costs.ts";

export interface SwingPlan { entryLow: number; entryHigh: number; stop: number; t1: number; t2: number; riskPct: number; exitBy: number }
export interface SwingSignal { score: number; reasons: string[]; plan: SwingPlan; setup: "Breakout" | "Pullback" | "Momentum" }

const r2 = (x: number) => Math.round(x * 100) / 100;
export const SWING_THRESHOLD = 65;
export const SWING_HOLD = 10;

/** Indicator series for one stock, computed once so every day can be scored quickly. */
export function swingSeries(b: Bar[]) {
  const n = b.length, c = b.map((x) => x.close);
  const sma = (k: number) => { const out: (number | null)[] = Array(n).fill(null); let s = 0; for (let i = 0; i < n; i++) { s += c[i]; if (i >= k) s -= c[i - k]; if (i >= k - 1) out[i] = s / k; } return out; };
  const s20 = sma(20), s50 = sma(50);
  // Wilder RSI(14) and ATR(14).
  const rsi: (number | null)[] = Array(n).fill(null), atr: (number | null)[] = Array(n).fill(null);
  let ag = 0, al = 0, tr = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1], g = Math.max(0, d), l = Math.max(0, -d);
    const t = Math.max(b[i].high - b[i].low, Math.abs(b[i].high - c[i - 1]), Math.abs(b[i].low - c[i - 1]));
    if (i <= 14) { ag += g / 14; al += l / 14; tr += t / 14; if (i === 14) { rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); atr[i] = tr; } }
    else { ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; tr = (tr * 13 + t) / 14; rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); atr[i] = tr; }
  }
  return { b, c, s20, s50, rsi, atr };
}
type Series = ReturnType<typeof swingSeries>;

/** Score day i (using only data up to and including that day). Null when a gate fails. */
export function swingAt(S: Series, i: number): SwingSignal | null {
  const { b, c, s20, s50, rsi, atr } = S;
  if (i < 60) return null;
  const p = c[i], m20 = s20[i], m50 = s50[i], m50p = s50[i - 5], R = rsi[i], A = atr[i];
  if (m20 == null || m50 == null || m50p == null || R == null || A == null || p <= 0) return null;
  const avg = (from: number, to: number, f: (x: Bar) => number) => { let s = 0; for (let k = from; k <= to; k++) s += f(b[k]); return s / (to - from + 1); };
  const turnover = avg(i - 19, i, (x) => x.amount ?? x.close * x.volume);
  const ret10 = (p / c[i - 10] - 1) * 100, ret20 = (p / c[i - 20] - 1) * 100;
  let upLimit = 0; for (let k = i - 9; k <= i; k++) if (c[k] >= c[k - 1] * 1.095) upLimit++;
  // Gates.
  if (turnover < 5e6 || p <= m50 || m20 <= m50 || m50 <= m50p || ret20 >= 30 || upLimit >= 3 || R < 45 || R > 72) return null;
  const reasons: string[] = [];
  let pts = 0;
  if (p > m20) { pts += 10; reasons.push("Above its rising 20- and 50-day averages."); }
  else reasons.push("Above its rising 50-day average.");
  pts += 10;
  if (ret10 >= 2 && ret10 <= 15) { pts += 15; reasons.push(`Healthy momentum: up ${r2(ret10)}% in 10 sessions, not overstretched.`); }
  else if (ret10 >= 0 && ret10 < 2) pts += 5;
  if (R >= 52 && R <= 68) { pts += 10; reasons.push(`RSI ${Math.round(R)}: strong but not overbought.`); }
  const v5 = avg(i - 4, i, (x) => x.volume), v50 = avg(i - 54, i - 5, (x) => x.volume);
  const vr = v50 ? v5 / v50 : 0;
  if (vr >= 1.3) { pts += 15; reasons.push(`Volume rising: ${r2(vr)}x its 50-day average.`); } else if (vr >= 1.1) pts += 8;
  let mfv = 0, vv = 0; for (let k = i - 19; k <= i; k++) { const x = b[k]; if (x.high > x.low) mfv += (((x.close - x.low) - (x.high - x.close)) / (x.high - x.low)) * x.volume; vv += x.volume; }
  const cmf = vv ? mfv / vv : 0;
  if (cmf > 0.05) { pts += 15; reasons.push(`Money flowing in (money flow ${r2(cmf)}).`); } else if (cmf > 0) pts += 8;
  let hi20 = 0; for (let k = i - 20; k < i; k++) hi20 = Math.max(hi20, b[k].high);
  let touched = false; for (let k = i - 2; k <= i; k++) if (s20[k] != null && b[k].low <= (s20[k] as number) * 1.01) touched = true;
  let setup: SwingSignal["setup"] = "Momentum";
  if (p >= hi20 * 0.97) { pts += 15; setup = "Breakout"; reasons.push(p >= hi20 ? `Breaking above its 20-session high (Rs. ${r2(hi20)}).` : `Within 3% of its 20-session high (Rs. ${r2(hi20)}).`); }
  else if (touched && p <= m20 * 1.03) { pts += 15; setup = "Pullback"; reasons.push(`Pulled back to its 20-day average (Rs. ${r2(m20)}) and held.`); }
  const x = b[i];
  if (x.high > x.low && (p - x.low) / (x.high - x.low) >= 0.5) { pts += 10; reasons.push("Closed in the upper half of the day's range."); }
  // Plan.
  let lo5 = Infinity; for (let k = i - 4; k <= i; k++) lo5 = Math.min(lo5, b[k].low);
  let stop = Math.max(lo5 * 0.995, p - 1.5 * A);
  if (stop > p * 0.985) stop = p - A;
  if ((p - stop) / p > 0.08) stop = p * 0.92;
  const risk = p - stop;
  const plan: SwingPlan = { entryLow: r2(p * 0.99), entryHigh: r2(p * 1.015), stop: r2(stop), t1: r2(p + 1.5 * risk), t2: r2(p + 2.5 * risk), riskPct: r2((risk / p) * 100), exitBy: SWING_HOLD };
  return { score: pts, reasons, plan, setup };
}

export interface SwingTrade { symbol: string; date: string; exitDate: string; entry: number; netPct: number; outcome: "target" | "stop" | "time"; marketDown: boolean; setup?: string; score?: number }
/** Replays one signal from the next session: buy at the open (skipped if it gaps above the buy range). */
export function simulate(S: Series, i: number, sig: SwingSignal, cfg: FeeConfig = DEFAULT_FEES): Omit<SwingTrade, "symbol" | "marketDown" | "setup" | "score"> | null {
  const b = S.b, pl = sig.plan;
  if (i + 1 >= b.length) return null;
  const entry = b[i + 1].open;
  if (!(entry > 0) || entry > pl.entryHigh || entry <= pl.stop) return null;
  const qty = Math.max(10, Math.floor(100_000 / entry));
  const half = Math.floor(qty / 2);
  let stop = pl.stop, left = qty, proceeds = 0, outcome: SwingTrade["outcome"] = "time", exitIdx = i + 1, t1Done = false;
  for (let j = i + 1; j < b.length && j <= i + SWING_HOLD; j++) {
    const d = b[j]; exitIdx = j;
    if (d.low <= stop) { proceeds += sellCost(left, Math.min(d.open, stop), cfg).net; left = 0; outcome = t1Done ? "target" : "stop"; break; }
    if (!t1Done && d.high >= pl.t1) { proceeds += sellCost(half, Math.max(d.open, pl.t1), cfg).net; left -= half; t1Done = true; stop = Math.max(stop, entry); }
    if (t1Done && d.high >= pl.t2) { proceeds += sellCost(left, Math.max(d.open, pl.t2), cfg).net; left = 0; outcome = "target"; break; }
  }
  if (left > 0) { if (exitIdx < i + SWING_HOLD && exitIdx === b.length - 1) return null; proceeds += sellCost(left, b[exitIdx].close, cfg).net; if (t1Done) outcome = "target"; }
  const cost = buyCost(qty, entry, cfg).net, gain = proceeds - cost;
  const tax = gain > 0 ? gain * cgtRate(SWING_HOLD, "individual", cfg, b[exitIdx].date) : 0;
  return { date: b[i].date, exitDate: b[exitIdx].date, entry: r2(entry), netPct: r2(((gain - tax) / cost) * 100), outcome };
}

export interface SwingStats { trades: number; winRatePct: number | null; avgNetPct: number | null; medianNetPct: number | null; targetPct: number | null; stopPct: number | null; from: string | null; to: string | null }
export function stats(t: SwingTrade[]): SwingStats {
  if (!t.length) return { trades: 0, winRatePct: null, avgNetPct: null, medianNetPct: null, targetPct: null, stopPct: null, from: null, to: null };
  const s = [...t].map((x) => x.netPct).sort((a, b) => a - b);
  return {
    trades: t.length, winRatePct: r2((t.filter((x) => x.netPct > 0).length / t.length) * 100), avgNetPct: r2(s.reduce((a, x) => a + x, 0) / s.length), medianNetPct: s[Math.floor(s.length / 2)],
    targetPct: r2((t.filter((x) => x.outcome === "target").length / t.length) * 100), stopPct: r2((t.filter((x) => x.outcome === "stop").length / t.length) * 100),
    from: t.reduce((m, x) => (x.date < m ? x.date : m), t[0].date), to: t.reduce((m, x) => (x.date > m ? x.date : m), t[0].date),
  };
}

/**
 * Backtest the list over the last `days` sessions: each day take the top `perDay` stocks scoring at least the
 * threshold (one open trade per stock at a time). `marketDown` marks days when NEPSE was below its 50-day average.
 */
export function backtestSwing(stocks: { symbol: string; bars: Bar[] }[], nepse: { date: string; close: number }[], days = 250, perDay = 5, cfg: FeeConfig = DEFAULT_FEES) {
  const S = stocks.map((s) => ({ symbol: s.symbol, S: swingSeries(s.bars), idx: new Map(s.bars.map((x, k) => [x.date, k])) }));
  const nIdx = new Map(nepse.map((x, k) => [x.date, k]));
  const nSma = (d: string) => { const k = nIdx.get(d); if (k == null || k < 50) return null; let s = 0; for (let j = k - 49; j <= k; j++) s += nepse[j].close; return { close: nepse[k].close, sma50: s / 50 }; };
  const dates = [...new Set(stocks.flatMap((s) => s.bars.map((x) => x.date)))].sort();
  const test = dates.slice(-(days + SWING_HOLD + 1), -(SWING_HOLD + 1));
  const busyUntil = new Map<string, string>();
  const trades: SwingTrade[] = [];
  for (const d of test) {
    const m = nSma(d), marketDown = !!m && m.close < m.sma50;
    const cands: { symbol: string; S: Series; i: number; sig: SwingSignal }[] = [];
    for (const s of S) {
      const i = s.idx.get(d); if (i == null) continue;
      if ((busyUntil.get(s.symbol) ?? "") >= d) continue;
      const sig = swingAt(s.S, i); if (sig && sig.score >= SWING_THRESHOLD) cands.push({ symbol: s.symbol, S: s.S, i, sig });
    }
    cands.sort((a, b) => b.sig.score - a.sig.score);
    for (const c of cands.slice(0, perDay)) {
      const t = simulate(c.S, c.i, c.sig, cfg);
      if (!t) continue;
      trades.push({ symbol: c.symbol, marketDown, setup: c.sig.setup, score: c.sig.score, ...t });
      busyUntil.set(c.symbol, t.exitDate);
    }
  }
  return { trades, all: stats(trades), marketDown: stats(trades.filter((t) => t.marketDown)), marketUp: stats(trades.filter((t) => !t.marketDown)), recent: trades.slice(-12).reverse() };
}
