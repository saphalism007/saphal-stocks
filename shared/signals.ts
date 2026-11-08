// Trading setup generator. Every setup is built from computed indicators and
// support/resistance levels, includes a stop-loss and targets, and states what
// would invalidate it. NEPSE is long-only, so "sell" setups mean exit/avoid.
import type { Bar } from "./types.ts";
import { computeAll, last, type IndicatorSet } from "./indicators.ts";
import { analyzeLevels, type LevelAnalysis } from "./levels.ts";
import { detectPatterns, type Pattern } from "./patterns.ts";
import { roundTrip, DEFAULT_FEES, type FeeConfig } from "./costs.ts";

export type SetupType = "Breakout" | "Pullback to support" | "Momentum" | "Oversold bounce" | "Trend continuation" | "Breakdown (exit/avoid)" | "Overbought at resistance (trim)";

export interface Setup {
  symbol: string;
  type: SetupType;
  side: "buy" | "sell";
  horizon: "swing (1-4 weeks)" | "positional (1-6 months)";
  asOf: string;
  price: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  targets: number[];
  riskReward: number; // to target 1, from mid-entry
  riskPct: number;
  supports: number[];
  resistances: number[];
  reasoning: string[];
  volume: { ratio: number; confirmed: boolean; note: string };
  quality: number; // 0-100
  qualityFactors: { factor: string; points: number }[];
  invalidation: string[];
  netOfCosts?: { breakevenPrice: number; netReturnAtT1Pct: number };
  fundamentalContext?: string;
}

export interface TechnicalSnapshot {
  asOf: string;
  close: number;
  changePct: number | null;
  trend: "uptrend" | "downtrend" | "sideways";
  trendNotes: string[];
  rsi: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null; cross: "bullish" | "bearish" | null };
  adx: number | null;
  atr: number | null;
  atrPct: number | null;
  volumeRatio: number | null;
  sma: Record<string, number | null>;
  ema: Record<string, number | null>;
  bollinger: { upper: number | null; middle: number | null; lower: number | null; percentB: number | null };
  stochastic: { k: number | null; d: number | null };
  supertrend: { value: number | null; direction: 1 | -1 | null };
  psar: number | null;
  vwap20: number | null;
  ichimoku: { tenkan: number | null; kijun: number | null; cloudTop: number | null; cloudBottom: number | null; position: "above" | "below" | "inside" | null };
  obvTrend: "rising" | "falling" | "flat" | null;
  high52: number;
  low52: number;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
  technicalScore: number; // 0-100
  scoreFactors: { factor: string; points: number }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function ret(bars: Bar[], sessions: number) {
  if (bars.length <= sessions) return null;
  const a = bars[bars.length - 1 - sessions].close;
  return r2(((bars[bars.length - 1].close - a) / a) * 100);
}

export function technicalSnapshot(bars: Bar[], ind?: IndicatorSet): TechnicalSnapshot | null {
  if (bars.length < 30) return null;
  const I = ind || computeAll(bars);
  const n = bars.length;
  const c = bars[n - 1].close;
  const L = <T,>(s: (T | null)[]) => last(s);
  const s50 = L(I.sma50), s200 = L(I.sma200), e20 = L(I.ema20);
  const factors: { factor: string; points: number }[] = [];
  const add = (factor: string, points: number) => factors.push({ factor, points });

  const trendNotes: string[] = [];
  let up = 0;
  if (s200 != null) { if (c > s200) { up++; trendNotes.push("Price is above the 200-day SMA (long-term uptrend)."); add("Above 200-day SMA", 12); } else { up--; trendNotes.push("Price is below the 200-day SMA (long-term downtrend)."); add("Below 200-day SMA", -8); } }
  if (s50 != null) { if (c > s50) { up++; add("Above 50-day SMA", 10); } else { up--; add("Below 50-day SMA", -6); } }
  if (s50 != null && s200 != null) { if (s50 > s200) { up++; trendNotes.push("50-day SMA is above the 200-day SMA."); add("50 SMA above 200 SMA", 8); } else { up--; trendNotes.push("50-day SMA is below the 200-day SMA."); } }
  if (e20 != null) { if (c > e20) add("Above 20-day EMA", 6); else add("Below 20-day EMA", -4); }
  const trend = up >= 2 ? "uptrend" : up <= -2 ? "downtrend" : "sideways";

  const r = L(I.rsi14);
  if (r != null) {
    if (r >= 50 && r <= 70) add("RSI in bullish zone (50-70)", 10);
    else if (r > 70) add("RSI overbought (>70)", 2);
    else if (r < 30) add("RSI oversold (<30)", 0);
    else add("RSI below 50", -4);
  }
  const m = L(I.macd.macd), sg = L(I.macd.signal), h = L(I.macd.histogram);
  let cross: "bullish" | "bearish" | null = null;
  const hs = I.macd.histogram;
  for (let i = n - 1; i >= Math.max(1, n - 5); i--) {
    if (hs[i] != null && hs[i - 1] != null) {
      if ((hs[i - 1] as number) <= 0 && (hs[i] as number) > 0) { cross = "bullish"; break; }
      if ((hs[i - 1] as number) >= 0 && (hs[i] as number) < 0) { cross = "bearish"; break; }
    }
  }
  if (h != null) add(h > 0 ? "MACD above signal" : "MACD below signal", h > 0 ? 8 : -5);
  if (cross === "bullish") add("Fresh bullish MACD cross (last 5 sessions)", 6);
  const adxV = L(I.adx.adx);
  const pdi = L(I.adx.plusDI), mdi = L(I.adx.minusDI);
  if (adxV != null && pdi != null && mdi != null) {
    if (adxV > 25 && pdi > mdi) add("Strong trend with +DI leading (ADX>25)", 8);
    else if (adxV > 25 && mdi > pdi) add("Strong downtrend (ADX>25, -DI leading)", -8);
  }
  const v20 = I.volSma20[n - 2];
  const vr = v20 ? bars[n - 1].volume / (v20 as number) : null;
  const obv = I.obv;
  const obvTrend = n > 20 ? (obv[n - 1] > obv[n - 21] * 1.02 || obv[n - 1] - obv[n - 21] > 0 ? "rising" : obv[n - 1] < obv[n - 21] ? "falling" : "flat") : null;
  if (obvTrend === "rising") add("On-balance volume rising (accumulation)", 6);
  if (obvTrend === "falling") add("On-balance volume falling (distribution)", -4);
  const st = L(I.supertrend.line), sd = L(I.supertrend.direction);
  if (sd === 1) add("Supertrend bullish", 6); else if (sd === -1) add("Supertrend bearish", -4);
  const ia = L(I.ichimoku.senkouA), ib = L(I.ichimoku.senkouB);
  let ipos: "above" | "below" | "inside" | null = null;
  if (ia != null && ib != null) { const top = Math.max(ia, ib), bot = Math.min(ia, ib); ipos = c > top ? "above" : c < bot ? "below" : "inside"; if (ipos === "above") add("Above Ichimoku cloud", 5); if (ipos === "below") add("Below Ichimoku cloud", -4); }

  const yr = bars.slice(-250);
  const high52 = Math.max(...yr.map((b) => b.high));
  const low52 = Math.min(...yr.map((b) => b.low));
  if (c >= high52 * 0.95) add("Within 5% of 52-week high", 6);
  // Normalise: 0 net points = 50; the maximum achievable positive sum (~91) = 100.
  const raw = 50 + (factors.reduce((s, f) => s + f.points, 0) * 50) / 91;
  const atrV = L(I.atr14);
  return {
    asOf: bars[n - 1].date,
    close: c,
    changePct: n > 1 ? r2(((c - bars[n - 2].close) / bars[n - 2].close) * 100) : null,
    trend, trendNotes,
    rsi: r != null ? r2(r) : null,
    macd: { macd: m != null ? r2(m) : null, signal: sg != null ? r2(sg) : null, histogram: h != null ? r2(h) : null, cross },
    adx: adxV != null ? r2(adxV) : null,
    atr: atrV != null ? r2(atrV) : null,
    atrPct: atrV != null ? r2((atrV / c) * 100) : null,
    volumeRatio: vr != null ? r2(vr) : null,
    sma: { 20: n2(L(I.sma20)), 50: n2(s50), 100: n2(L(I.sma100)), 200: n2(s200) },
    ema: { 9: n2(L(I.ema9)), 20: n2(e20), 50: n2(L(I.ema50)), 200: n2(L(I.ema200)) },
    bollinger: { upper: n2(L(I.bollinger.upper)), middle: n2(L(I.bollinger.middle)), lower: n2(L(I.bollinger.lower)), percentB: n2(L(I.bollinger.percentB)) },
    stochastic: { k: n2(L(I.stochastic.k)), d: n2(L(I.stochastic.d)) },
    supertrend: { value: n2(st), direction: sd },
    psar: n2(L(I.psar)),
    vwap20: n2(L(I.vwap.rolling)),
    ichimoku: { tenkan: n2(L(I.ichimoku.tenkan)), kijun: n2(L(I.ichimoku.kijun)), cloudTop: ia != null && ib != null ? r2(Math.max(ia, ib)) : null, cloudBottom: ia != null && ib != null ? r2(Math.min(ia, ib)) : null, position: ipos },
    obvTrend,
    high52, low52,
    return1m: ret(bars, 21), return3m: ret(bars, 63), return6m: ret(bars, 126), return1y: ret(bars, 250),
    technicalScore: Math.max(0, Math.min(100, Math.round(raw))),
    scoreFactors: factors,
  };
}
const n2 = (x: number | null) => (x == null ? null : r2(x));

export interface SignalContext { symbol: string; fees?: FeeConfig; fundamentalNote?: string; fundamentalScore?: number | null }

export function generateSetups(bars: Bar[], ctx: SignalContext): { setups: Setup[]; snapshot: TechnicalSnapshot | null; levels: LevelAnalysis | null; patterns: Pattern[] } {
  const snap = technicalSnapshot(bars);
  const levels = analyzeLevels(bars);
  const patterns = detectPatterns(bars);
  const setups: Setup[] = [];
  if (!snap || !levels || bars.length < 60) return { setups, snapshot: snap, levels, patterns };
  // Ignore stale or illiquid series: no trade on the latest session = no signal.
  const lastBar = bars[bars.length - 1];
  if (!lastBar.volume) return { setups, snapshot: snap, levels, patterns };
  const c = snap.close;
  const a = snap.atr || c * 0.02;
  const sup = levels.supports.map((l) => l.price);
  const res = levels.resistances.map((l) => l.price);
  const nearestSup = levels.supports[0];
  const nearestRes = levels.resistances[0];
  const vr = snap.volumeRatio ?? 0;
  const volume = { ratio: vr, confirmed: vr >= 1.5, note: vr >= 1.5 ? `Latest volume ${vr}x the 20-day average (confirming).` : vr >= 1 ? `Latest volume ${vr}x average (neutral).` : `Latest volume ${vr}x average (weak participation).` };
  const fees = ctx.fees || DEFAULT_FEES;

  const make = (s: Omit<Setup, "symbol" | "asOf" | "price" | "riskReward" | "riskPct" | "supports" | "resistances" | "volume" | "quality" | "netOfCosts"> & { baseQuality: number }): Setup | null => {
    const mid = (s.entryLow + s.entryHigh) / 2;
    const risk = s.side === "buy" ? mid - s.stopLoss : s.stopLoss - mid;
    if (risk <= 0 || !s.targets.length) return null;
    const reward = s.side === "buy" ? s.targets[0] - mid : mid - s.targets[0];
    const rr = reward / risk;
    if (s.side === "buy" && rr < 1.2) return null; // not worth flagging
    const qf = [...s.qualityFactors];
    if (volume.confirmed) qf.push({ factor: "Volume confirmation", points: 10 });
    if (rr >= 2) qf.push({ factor: "Risk/reward >= 2", points: 8 });
    if (snap.trend === "uptrend" && s.side === "buy") qf.push({ factor: "Aligned with primary uptrend", points: 10 });
    if (snap.trend === "downtrend" && s.side === "buy") qf.push({ factor: "Against primary downtrend", points: -12 });
    if (ctx.fundamentalScore != null && s.side === "buy") qf.push({ factor: `Fundamental score ${ctx.fundamentalScore}`, points: Math.round((ctx.fundamentalScore - 50) / 5) });
    const quality = Math.max(0, Math.min(100, Math.round(s.baseQuality + qf.reduce((t, f) => t + f.points, 0))));
    let netOfCosts: Setup["netOfCosts"];
    if (s.side === "buy") {
      const rt = roundTrip(100, mid, s.targets[0], 30, fees);
      netOfCosts = { breakevenPrice: r2(rt.breakevenPrice), netReturnAtT1Pct: r2(rt.netReturnPct) };
    }
    const { baseQuality: _b, ...rest } = s;
    return {
      ...rest, symbol: ctx.symbol, asOf: snap.asOf, price: c, riskReward: r2(rr), riskPct: r2((risk / mid) * 100),
      entryLow: r2(s.entryLow), entryHigh: r2(s.entryHigh), stopLoss: r2(s.stopLoss), targets: s.targets.map(r2),
      supports: sup.slice(0, 3), resistances: res.slice(0, 3), volume, quality, qualityFactors: qf, netOfCosts,
      fundamentalContext: ctx.fundamentalNote,
    };
  };
  const targetsAbove = (from: number, minGap: number) => {
    const t = res.filter((p) => p > from + minGap);
    const out = t.slice(0, 3);
    if (out.length < 2) out.push(...[from + 2 * a * 1.5, from + 3 * a * 1.5].filter((x) => !out.some((o) => Math.abs(o - x) < a)).slice(0, 2 - out.length));
    return out.sort((x, y) => x - y).slice(0, 3);
  };

  // 1) Breakout: close above major resistance zone / 20-day high.
  const bo = patterns.find((p) => p.name === "Breakout");
  if (bo && bo.keyLevel) {
    const s = make({
      type: "Breakout", side: "buy", horizon: "swing (1-4 weeks)",
      entryLow: bo.keyLevel, entryHigh: Math.min(c * 1.02, bo.keyLevel + a),
      stopLoss: Math.max(bo.keyLevel - 1.2 * a, (nearestSup?.price ?? 0)),
      targets: targetsAbove(c, a * 0.5),
      reasoning: [bo.description, ...snap.trendNotes.slice(0, 2), "Breakouts work best when the prior resistance now acts as support; buying close to the breakout level keeps risk small."],
      qualityFactors: [{ factor: "Price breakout", points: 15 }],
      invalidation: [`Daily close back below Rs. ${r2(bo.keyLevel - 0.5 * a)} (failed breakout).`, "Volume dries up over the next 2-3 sessions."],
      baseQuality: 40,
    });
    if (s) setups.push(s);
  }

  // 2) Pullback to support in an uptrend.
  if (snap.trend === "uptrend" && nearestSup && (c - nearestSup.price) / c < 0.04 && (snap.rsi ?? 50) < 60) {
    const s = make({
      type: "Pullback to support", side: "buy", horizon: "swing (1-4 weeks)",
      entryLow: nearestSup.price, entryHigh: Math.min(c, nearestSup.high + 0.3 * a),
      stopLoss: nearestSup.low - 0.5 * a,
      targets: targetsAbove(c, a * 0.5),
      reasoning: [`Primary trend is up and price has pulled back to support at Rs. ${nearestSup.price} (${nearestSup.strength}, ${nearestSup.reactions} reactions).`, nearestSup.why],
      qualityFactors: [{ factor: `${nearestSup.strength} support (score ${nearestSup.score})`, points: Math.round(nearestSup.score / 5) }],
      invalidation: [nearestSup.invalidation, "RSI falling below 40 with rising volume would signal the pullback is turning into a downtrend."],
      baseQuality: 40,
    });
    if (s) setups.push(s);
  }

  // 3) Momentum: fresh MACD cross, RSI 50-68, above 50 SMA, ADX >= 20.
  if (snap.macd.cross === "bullish" && (snap.rsi ?? 0) >= 50 && (snap.rsi ?? 100) <= 68 && snap.sma[50] != null && c > (snap.sma[50] as number) && (snap.adx ?? 0) >= 18) {
    const stop = Math.max(c - 2 * a, (nearestSup?.low ?? c - 2 * a));
    const s = make({
      type: "Momentum", side: "buy", horizon: "swing (1-4 weeks)",
      entryLow: c - 0.3 * a, entryHigh: c + 0.3 * a, stopLoss: Math.min(stop, c - a),
      targets: targetsAbove(c, a * 0.5),
      reasoning: [`Fresh bullish MACD crossover with RSI ${snap.rsi} and price above the 50-day SMA.`, `ADX ${snap.adx} indicates ${snap.adx! >= 25 ? "a strong" : "an emerging"} trend.`],
      qualityFactors: [{ factor: "MACD bullish cross", points: 10 }],
      invalidation: ["MACD crosses back below its signal line.", `Close below Rs. ${r2(Math.min(stop, c - a))}.`],
      baseQuality: 35,
    });
    if (s) setups.push(s);
  }

  // 4) Oversold bounce at support (counter-trend, smaller size).
  if ((snap.rsi ?? 100) < 33 && nearestSup && (c - nearestSup.price) / c < 0.03) {
    const s = make({
      type: "Oversold bounce", side: "buy", horizon: "swing (1-4 weeks)",
      entryLow: nearestSup.price, entryHigh: c, stopLoss: nearestSup.low - 0.6 * a,
      targets: targetsAbove(c, a * 0.3).slice(0, 2),
      reasoning: [`RSI ${snap.rsi} is oversold and price is at support Rs. ${nearestSup.price}.`, "Counter-trend trades have lower odds; use smaller position size and take profits quickly."],
      qualityFactors: [{ factor: "Oversold at support", points: 8 }, { factor: "Counter-trend", points: -5 }],
      invalidation: [nearestSup.invalidation],
      baseQuality: 30,
    });
    if (s) setups.push(s);
  }

  // 5) Trend continuation (positional): strong uptrend, close above EMA20, ADX>25.
  if (snap.trend === "uptrend" && (snap.adx ?? 0) > 25 && snap.ema[20] != null && c > (snap.ema[20] as number) && (snap.rsi ?? 0) < 72 && !setups.length) {
    const e20 = snap.ema[20] as number;
    const s = make({
      type: "Trend continuation", side: "buy", horizon: "positional (1-6 months)",
      entryLow: e20, entryHigh: c, stopLoss: Math.min(e20 - 1.5 * a, snap.sma[50] ?? e20 - 2 * a),
      targets: targetsAbove(c, a),
      reasoning: ["Established uptrend (price above 20/50/200 averages) with ADX above 25.", "Buying near the 20-day EMA on dips keeps the entry close to dynamic support."],
      qualityFactors: [{ factor: "Strong trend", points: 10 }],
      invalidation: ["Weekly close below the 50-day SMA.", "50-day SMA crossing below the 200-day SMA."],
      baseQuality: 35,
    });
    if (s) setups.push(s);
  }

  // 6) Breakdown: exit/avoid.
  const bd = patterns.find((p) => p.name === "Breakdown") || (nearestSup && c < nearestSup.low ? null : null);
  if (bd && bd.keyLevel) {
    setups.push({
      symbol: ctx.symbol, type: "Breakdown (exit/avoid)", side: "sell", horizon: "swing (1-4 weeks)", asOf: snap.asOf, price: c,
      entryLow: r2(c), entryHigh: r2(bd.keyLevel), stopLoss: r2(bd.keyLevel + a), targets: sup.filter((p) => p < c).slice(0, 2),
      riskReward: 0, riskPct: r2(((bd.keyLevel + a - c) / c) * 100), supports: sup.slice(0, 3), resistances: res.slice(0, 3), volume,
      reasoning: [bd.description, "NEPSE does not allow short selling: treat this as a signal to protect existing holdings or avoid new buys."],
      quality: Math.round(40 + (volume.confirmed ? 15 : 0) + (snap.trend === "downtrend" ? 10 : 0)), qualityFactors: [],
      invalidation: [`Recovery and close above Rs. ${r2(bd.keyLevel + 0.5 * a)}.`],
    });
  }
  // 7) Overbought at resistance: consider trimming.
  if ((snap.rsi ?? 0) > 72 && nearestRes && (nearestRes.price - c) / c < 0.03) {
    setups.push({
      symbol: ctx.symbol, type: "Overbought at resistance (trim)", side: "sell", horizon: "swing (1-4 weeks)", asOf: snap.asOf, price: c,
      entryLow: r2(c), entryHigh: r2(nearestRes.price), stopLoss: r2(nearestRes.high + a), targets: sup.slice(0, 2), riskReward: 0,
      riskPct: 0, supports: sup.slice(0, 3), resistances: res.slice(0, 3), volume,
      reasoning: [`RSI ${snap.rsi} is overbought right below resistance Rs. ${nearestRes.price} (${nearestRes.reactions} prior reactions).`, "Consider booking partial profits or tightening stops rather than adding."],
      quality: 45, qualityFactors: [], invalidation: [`Close above Rs. ${nearestRes.high} on strong volume (resistance broken).`],
    });
  }
  return { setups: setups.sort((x, y) => y.quality - x.quality), snapshot: snap, levels, patterns };
}
