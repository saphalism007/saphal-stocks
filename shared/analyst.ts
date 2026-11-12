// Chart analyst: turns one stock's real daily bars (plus stored fundamentals) into a decision panel,
// verdict, entry/stop/targets, the evidence behind it, support/resistance with how each level was
// found, strategies by holding period, and separate short/medium/long-term assessments. It builds on
// the same engines as Trading Opportunities (shared/opportunities.ts, signals.ts, levels.ts,
// patterns.ts) so both pages always agree. No randomness, no invented values: every number shown is
// computed from the bars or the stored statements. Pure; tested in tests/analyst.test.ts.
import type { Bar } from "./types.ts";
import { closureOn } from "./holidays.ts";
import type { Opportunity } from "./opportunities.ts";
import { netRR, RULES } from "./opportunities.ts";
import { generateSetups, type Setup, type TechnicalSnapshot } from "./signals.ts";
import type { LevelAnalysis } from "./levels.ts";
import type { Pattern } from "./patterns.ts";
import { recentCandles, type Candle } from "./candles.ts";
import { rsi as rsiS, macd as macdS, sma as smaS, ema as emaS, atr as atrS, bollinger } from "./indicators.ts";
import { zigzag, mfi as mfiS } from "./ta.ts";
import { DEFAULT_FEES, type FeeConfig } from "./costs.ts";

export type Verdict = "STRONG BUY" | "BUY" | "WAIT" | "HOLD" | "SELL" | "STRONG SELL" | "NO SIGNAL";
export type Tone = "bull" | "bear" | "neutral";
export interface Reason { topic: string; text: string; tone: Tone }
export interface KeyLevel { kind: string; price: number; low?: number; high?: number; why: string; how: string; side: "support" | "resistance" | "trigger" }
export interface Strategy { key: "intraday" | "short" | "swing" | "positional" | "long"; title: string; horizon: string; available: boolean; stance: string; tone: Tone; entryLow: number | null; entryHigh: number | null; stop: number | null; targets: number[]; netRR: number | null; notes: string[] }
export interface Assessment { label: "Suitable" | "Mixed" | "Not suitable" | "Not enough data"; score: number | null; reasons: string[] }
export interface Event { date: string; text: string; tone: Tone }
export interface FundSummary {
  score: number | null; period: string | null; sectorGroup?: string | null;
  eps: number | null; pe: number | null; pb: number | null; bvps: number | null; roe: number | null; de: number | null; graham: number | null;
  profitGrowth: number | null; revenueGrowth: number | null; cashYield: number | null; dividendYears5: number | null; sectorPe: number | null;
  redFlags: string[]; strengths: string[];
}
export interface TrackSummary { trades: number; winRatePct: number | null; avgNetPct: number | null; targetHitPct: number | null; stopHitPct: number | null; recent: { date: string; type: string; outcome: string; netPct: number }[] }
export interface AnalystInput { symbol: string; name: string; sector: string; bars: Bar[]; opp: Opportunity & { history?: { trades: number; winRatePct: number | null; avgNetPct: number | null } | null }; fund: FundSummary | null; fees?: FeeConfig; stockTrack?: TrackSummary | null; avgTurnover20?: number | null; provisional?: boolean }

export interface ChartAnalysis {
  symbol: string; name: string; sector: string; asOf: string | null; price: number | null; changePct: number | null;
  verdict: Verdict; tone: Tone; headline: string; confidence: number; confidenceLabel: string;
  plan: { entryLow: number | null; entryHigh: number | null; bestZone: { low: number; high: number; why: string } | null; breakout: { price: number; why: string } | null; stop: number | null; stopWhy: string | null; targets: { price: number; basis: string; pct: number }[]; riskReward: number | null; netRiskReward: number | null; riskPct: number | null; holding: string | null; buyNow: string | null; waitFor: string | null; reviewBy: string | null; expiry: string };
  reasons: Reason[]; risks: string[]; invalidation: string[];
  levels: KeyLevel[]; zones: { kind: "demand" | "supply"; low: number; high: number; why: string; fresh: boolean }[];
  strategies: Strategy[];
  assessments: { short: Assessment; medium: Assessment; long: Assessment };
  events: Event[]; candles: Candle[]; patterns: Pattern[];
  divergences: { indicator: string; dir: "bullish" | "bearish"; text: string; from: string; to: string; fromPrice: number; toPrice: number }[];
  structure: { label: string; tone: Tone; pivots: { date: string; price: number; kind: "high" | "low" }[] };
  indicators: Record<string, number | null>;
  scores: { technical: number | null; fundamental: number | null };
  tags: string[]; tagNotes: Record<string, string>;
  history: TrackSummary | null; setupHistory: { trades: number; winRatePct: number | null; avgNetPct: number | null } | null;
  dataNotes: string[];
  fund?: FundSummary | null;
  orders?: TradeOrders;
  signals?: PastSignal[];
}
export interface OrderStep { kind: "buy" | "sell" | "stop" | "wait" | "hold" | "avoid"; title: string; text: string; price?: number | null; low?: number | null; high?: number | null }
export interface TradeOrders { action: string; summary: string; session: string; forBuyers: OrderStep[]; forHolders: OrderStep[]; validUntil: string; note: string }
/** A past buy signal from the same rules (back-test), with how it ended. */
export interface PastSignal { date: string; entryDate: string; entry: number; stop: number; t1: number; exitDate: string; exit: number; outcome: string; netPct: number }

const r2 = (x: number) => Math.round(x * 100) / 100;
const rs = (x: number | null | undefined) => (x == null ? "-" : `Rs. ${r2(x).toLocaleString("en-IN")}`);
const pc = (x: number | null | undefined, d = 1) => (x == null ? "-" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`);
const lastN = (s: (number | null)[], back = 0) => { for (let i = s.length - 1 - back; i >= 0; i--) if (s[i] != null) return s[i] as number; return null; };
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const LEVEL_HOW = "Found by clustering swing highs and lows (3-session pivots) over up to 500 sessions within ±½ ATR; scored by how many times price reacted there, how often it was tested, volume at the reactions and how recent they are.";

/** RSI and MACD divergences between the last two swing points (window 3) in the last 80 sessions. */
export function divergences(bars: Bar[]) {
  const out: ChartAnalysis["divergences"] = [];
  if (bars.length < 60) return out;
  const c = bars.map((b) => b.close), r = rsiS(c, 14), m = macdS(c).histogram;
  const from = bars.length - 80, w = 3;
  const lows: number[] = [], highs: number[] = [];
  for (let i = Math.max(w, from); i < bars.length - 1; i++) {
    let lo = true, hi = true;
    for (let j = i - w; j <= Math.min(bars.length - 1, i + w); j++) { if (j === i) continue; if (bars[j].low < bars[i].low) lo = false; if (bars[j].high > bars[i].high) hi = false; }
    if (lo) lows.push(i); if (hi) highs.push(i);
  }
  const check = (idx: number[], kind: "low" | "high") => {
    if (idx.length < 2) return;
    const b = idx[idx.length - 1], a = idx[idx.length - 2];
    if (bars.length - 1 - b > 15 || b - a < 5) return;
    const pa = kind === "low" ? bars[a].low : bars[a].high, pb = kind === "low" ? bars[b].low : bars[b].high;
    for (const [name, s] of [["RSI", r], ["MACD histogram", m]] as const) {
      const va = s[a], vb = s[b];
      if (va == null || vb == null) continue;
      if (kind === "low" && pb < pa && vb > va) out.push({ indicator: name, dir: "bullish", text: `Bullish ${name} divergence: price made a lower low (${rs(pa)} > ${rs(pb)}) but ${name} made a higher low (${r2(va)} > ${r2(vb)}). Selling pressure is weakening.`, from: bars[a].date, to: bars[b].date, fromPrice: pa, toPrice: pb });
      if (kind === "high" && pb > pa && vb < va) out.push({ indicator: name, dir: "bearish", text: `Bearish ${name} divergence: price made a higher high (${rs(pa)} > ${rs(pb)}) but ${name} made a lower high (${r2(va)} > ${r2(vb)}). Buying pressure is weakening.`, from: bars[a].date, to: bars[b].date, fromPrice: pa, toPrice: pb });
    }
  };
  check(lows, "low"); check(highs, "high");
  return out;
}

/** Market structure from 5% zigzag pivots: higher highs/lows, lower highs/lows or a range. */
export function structure(bars: Bar[]): ChartAnalysis["structure"] {
  const z = zigzag(bars.slice(-250), 5);
  const base = Math.max(0, bars.length - 250);
  const piv: { date: string; price: number; kind: "high" | "low" }[] = [];
  z.forEach((v, i) => { if (v != null && i > 0) { const b = bars[base + i]; piv.push({ date: b.date, price: v, kind: v >= b.high - 1e-9 ? "high" : "low" }); } });
  const H = piv.filter((p) => p.kind === "high").slice(-2), L = piv.filter((p) => p.kind === "low").slice(-2);
  if (H.length < 2 || L.length < 2) return { label: "Not enough swings to read structure", tone: "neutral", pivots: piv.slice(-8) };
  const hh = H[1].price > H[0].price, hl = L[1].price > L[0].price;
  const label = hh && hl ? `Higher highs and higher lows (uptrend structure): highs ${rs(H[0].price)} > ${rs(H[1].price)}, lows ${rs(L[0].price)} > ${rs(L[1].price)}.`
    : !hh && !hl ? `Lower highs and lower lows (downtrend structure): highs ${rs(H[0].price)} > ${rs(H[1].price)}, lows ${rs(L[0].price)} > ${rs(L[1].price)}.`
    : hl ? `Higher lows but a lower high: buyers defend dips while sellers cap rallies (contracting range, often before a breakout).` : `Higher high but a lower low: wide, volatile range without a clear trend.`;
  return { label, tone: hh && hl ? "bull" : !hh && !hl ? "bear" : "neutral", pivots: piv.slice(-8) };
}

function recentEvents(bars: Bar[], snap: TechnicalSnapshot, patterns: Pattern[], candles: Candle[], divs: ChartAnalysis["divergences"]): Event[] {
  const out: Event[] = [];
  const n = bars.length, c = bars.map((b) => b.close), v = bars.map((b) => b.volume);
  const s50 = smaS(c, 50), s200 = smaS(c, 200), m = macdS(c), r = rsiS(c, 14), vAvg = smaS(v, 20), a = atrS(bars, 14), bb = bollinger(c, 20, 2);
  for (let i = Math.max(1, n - 15); i < n; i++) {
    const d = bars[i].date, p = i - 1;
    const cross = (x: (number | null)[], y: (number | null)[]) => x[i] != null && y[i] != null && x[p] != null && y[p] != null ? ((x[p] as number) <= (y[p] as number) && (x[i] as number) > (y[i] as number) ? 1 : (x[p] as number) >= (y[p] as number) && (x[i] as number) < (y[i] as number) ? -1 : 0) : 0;
    const gc = cross(s50, s200); if (gc) out.push({ date: d, text: gc > 0 ? "Golden cross: 50-day average crossed above the 200-day." : "Death cross: 50-day average crossed below the 200-day.", tone: gc > 0 ? "bull" : "bear" });
    const cs = cross(c, s50); if (cs) out.push({ date: d, text: cs > 0 ? `Closed above the 50-day average (${rs(s50[i])}).` : `Closed below the 50-day average (${rs(s50[i])}).`, tone: cs > 0 ? "bull" : "bear" });
    const c2 = cross(c, s200); if (c2) out.push({ date: d, text: c2 > 0 ? `Closed above the 200-day average (${rs(s200[i])}).` : `Closed below the 200-day average (${rs(s200[i])}).`, tone: c2 > 0 ? "bull" : "bear" });
    const mc = cross(m.macd, m.signal); if (mc) out.push({ date: d, text: mc > 0 ? "MACD crossed above its signal line." : "MACD crossed below its signal line.", tone: mc > 0 ? "bull" : "bear" });
    if (r[i] != null && r[p] != null) {
      if ((r[p] as number) < 30 && (r[i] as number) >= 30) out.push({ date: d, text: `RSI climbed back above 30 (${r2(r[i] as number)}): leaving oversold.`, tone: "bull" });
      if ((r[p] as number) > 70 && (r[i] as number) <= 70) out.push({ date: d, text: `RSI fell back below 70 (${r2(r[i] as number)}): momentum cooling.`, tone: "bear" });
    }
    if (vAvg[i] && v[i] >= 2 * (vAvg[i] as number)) out.push({ date: d, text: `Volume spike: ${r2(v[i] / (vAvg[i] as number))}x the 20-day average on a ${c[i] >= c[p] ? "rising" : "falling"} close.`, tone: c[i] >= c[p] ? "bull" : "bear" });
    const chg = ((c[i] - c[p]) / c[p]) * 100;
    if (Math.abs(chg) >= 8 || (a[p] != null && Math.abs(c[i] - c[p]) >= 2.5 * (a[p] as number))) out.push({ date: d, text: `Unusual move: ${pc(chg)} in one session${Math.abs(chg) >= 9.5 ? " (at or near NEPSE's ±10% circuit limit)" : ""}.`, tone: chg > 0 ? "bull" : "bear" });
    if (i === n - 1 && bb.bandwidth[i] != null) {
      const bw = bb.bandwidth.slice(Math.max(0, n - 120)).filter((x): x is number => x != null);
      if (bw.length >= 60 && (bb.bandwidth[i] as number) <= Math.min(...bw) * 1.05) out.push({ date: d, text: "Bollinger squeeze: bands are the narrowest in about 6 months; a large move often follows (direction unknown until the break).", tone: "neutral" });
    }
  }
  const hi = Math.max(...bars.slice(-250).map((b) => b.high)), lo = Math.min(...bars.slice(-250).map((b) => b.low));
  if (bars[n - 1].high >= hi) out.push({ date: bars[n - 1].date, text: `New 52-week high (${rs(hi)}).`, tone: "bull" });
  if (bars[n - 1].low <= lo) out.push({ date: bars[n - 1].date, text: `New 52-week low (${rs(lo)}).`, tone: "bear" });
  for (const cd of candles.filter((x) => x.dir !== "neutral")) out.push({ date: cd.date, text: `${cd.name}: ${cd.note}`, tone: cd.dir === "bullish" ? "bull" : "bear" });
  for (const p of patterns.filter((x) => x.endDate >= bars[Math.max(0, n - 15)].date)) out.push({ date: p.endDate, text: `${p.name} (${p.status}).`, tone: p.direction === "bullish" ? "bull" : p.direction === "bearish" ? "bear" : "neutral" });
  for (const d of divs) out.push({ date: d.to, text: d.text, tone: d.dir === "bullish" ? "bull" : "bear" });
  void snap;
  return out.sort((x, y) => (x.date < y.date ? 1 : -1));
}

function assess(score: number | null, reasons: string[], cut = [65, 45]): Assessment {
  if (score == null) return { label: "Not enough data", score: null, reasons };
  const s = Math.round(Math.max(0, Math.min(100, score)));
  return { label: s >= cut[0] ? "Suitable" : s >= cut[1] ? "Mixed" : "Not suitable", score: s, reasons };
}

export function analyzeChart(inp: AnalystInput): ChartAnalysis {
  const { bars, opp, fund } = inp;
  const fees = inp.fees ?? DEFAULT_FEES;
  const n = bars.length;
  const last = bars[n - 1], prev = bars[n - 2];
  const sig = generateSetups(bars, { symbol: inp.symbol, fees, fundamentalScore: fund?.score ?? null });
  const snap = sig.snapshot, lv: LevelAnalysis | null = sig.levels, patterns = sig.patterns;
  const candles = n >= 12 ? recentCandles(bars, 5) : [];
  const divs = divergences(bars);
  const struct = n >= 60 ? structure(bars) : { label: "Not enough history", tone: "neutral" as Tone, pivots: [] };
  const dataNotes: string[] = [];
  if (inp.provisional) dataNotes.push("The latest candle is built from today's live (delayed) prices and can change until the market closes at 3 PM.");
  if (n < RULES.minBars) dataNotes.push(`Only ${n} sessions of history: signals need at least ${RULES.minBars}.`);
  const base: ChartAnalysis = {
    symbol: inp.symbol, name: inp.name, sector: inp.sector, asOf: last?.date ?? null, price: last?.close ?? null, changePct: last && prev ? r2(((last.close - prev.close) / prev.close) * 100) : null,
    verdict: "NO SIGNAL", tone: "neutral", headline: opp.headline || "Not enough data for an analysis.", confidence: 0, confidenceLabel: "-",
    plan: { entryLow: null, entryHigh: null, bestZone: null, breakout: null, stop: null, stopWhy: null, targets: [], riskReward: null, netRiskReward: null, riskPct: null, holding: null, buyNow: null, waitFor: null, reviewBy: null, expiry: "" },
    reasons: [], risks: [], invalidation: [], levels: [], zones: [], strategies: [], assessments: { short: assess(null, []), medium: assess(null, []), long: assess(null, []) },
    events: [], candles, patterns, divergences: divs, structure: struct, indicators: {}, scores: { technical: null, fundamental: fund?.score ?? null }, tags: [], tagNotes: {},
    history: inp.stockTrack ?? null, setupHistory: opp.history ?? null, dataNotes, fund: fund ?? null,
  };
  if (!last || !snap || !lv || n < 60) return base;

  const c = snap.close, A = snap.atr ?? c * 0.02;
  const closes = bars.map((b) => b.close);
  const ema9 = lastN(emaS(closes, 9)), mfi = lastN(mfiS(bars, 14));
  const hist = macdS(closes).histogram, h0 = lastN(hist), h1 = lastN(hist, 1);
  const s20 = snap.sma[20] ?? null, s50 = snap.sma[50] ?? null, s200 = snap.sma[200] ?? null, e20 = snap.ema[20] ?? null;
  const upVol = bars.slice(-20).reduce((t, b, i, arr) => t + (i && b.close > arr[i - 1].close ? b.volume : 0), 0);
  const dnVol = bars.slice(-20).reduce((t, b, i, arr) => t + (i && b.close < arr[i - 1].close ? b.volume : 0), 0);
  const updown = dnVol ? r2(upVol / dnVol) : null;

  // ---------- verdict ----------
  const vConf = opp.indicators.volumeConfirmed === true;
  const bigDown = snap.trend === "downtrend" && (s200 != null && c < s200);
  let verdict: Verdict = "NO SIGNAL";
  switch (opp.action) {
    case "BUY": verdict = opp.confidence >= 75 && (opp.netRiskReward ?? 0) >= 2.5 && snap.trend === "uptrend" && vConf ? "STRONG BUY" : "BUY"; break;
    case "WATCH": verdict = "WAIT"; break;
    case "HOLD": verdict = "HOLD"; break;
    case "SELL": verdict = bigDown && opp.confidence >= 70 ? "STRONG SELL" : "SELL"; break;
    case "AVOID": verdict = /illiquid/i.test(opp.headline) ? "WAIT" : "SELL"; break;
    default: verdict = "NO SIGNAL";
  }
  const tone: Tone = verdict.includes("BUY") ? "bull" : verdict.includes("SELL") ? "bear" : "neutral";
  let headline = opp.headline;
  if (opp.action === "AVOID" && verdict === "SELL") headline = `${opp.headline} For holders: reduce or exit on rallies; not a buy.`;

  // ---------- plan ----------
  const sup = lv.supports, res = lv.resistances;
  const strongSup = [...sup].filter((l) => l.price < c).sort((a, b) => b.score - a.score)[0] ?? null;
  const strongRes = [...res].filter((l) => l.price > c).sort((a, b) => b.score - a.score)[0] ?? null;
  const demand = lv.zones.filter((z) => z.kind === "demand" && z.high < c * 1.01).sort((a, b) => b.high - a.high)[0];
  let bestZone: ChartAnalysis["plan"]["bestZone"] = null;
  if (opp.entryLow != null && opp.entryHigh != null) bestZone = { low: opp.entryLow, high: opp.entryHigh, why: `The ${opp.setupType?.toLowerCase() ?? "setup"} entry range: close to the level that defines the stop, so the risk per share stays small.` };
  else if (sup[0] && sup[0].price < c) bestZone = { low: r2(sup[0].low), high: r2(sup[0].high), why: `Nearest support (${sup[0].reactions} past reactions${sup[0].volumeConfirmed ? ", high volume there" : ""}). Buying here, with a stop just below, keeps risk tight.` };
  if (demand && (!bestZone || demand.high < bestZone.low)) bestZone = bestZone ?? { low: r2(demand.low), high: r2(demand.high), why: demand.why };
  const breakout = lv.breakoutLevel && lv.breakoutLevel > c ? { price: r2(lv.breakoutLevel), why: `A daily close above ${rs(lv.breakoutLevel)} (top of the major resistance zone) on at least 1.5x average volume would confirm a breakout; buy the close or a retest of the level.` } : null;
  const stop = opp.stop ?? (sup[0] ? r2(sup[0].low - 0.5 * A) : null);
  const stopWhy = opp.stop != null ? (opp.action === "SELL" ? "Exit if price closes below this level." : `Placed below the ${opp.setupType?.toLowerCase().includes("breakout") ? "breakout level" : "support that defines the setup"} with an ATR buffer (ATR ${rs(A)}) so normal daily noise doesn't trigger it.`)
    : stop != null ? `Half an ATR below the nearest support (${rs(sup[0]?.price)}).` : null;
  const targets = opp.targets.map((t) => ({ ...t, pct: r2(((t.price - c) / c) * 100) }));
  if (!targets.length && verdict !== "SELL" && verdict !== "STRONG SELL") for (const r of res.filter((x) => x.price > c * 1.01).slice(0, 3)) targets.push({ price: r2(r.price), basis: `Resistance (${r.reactions} reaction${r.reactions === 1 ? "" : "s"})`, pct: r2(((r.price - c) / c) * 100) });
  const plan: ChartAnalysis["plan"] = {
    entryLow: opp.entryLow, entryHigh: opp.entryHigh, bestZone, breakout, stop, stopWhy, targets,
    riskReward: opp.riskReward, netRiskReward: opp.netRiskReward, riskPct: opp.riskPct, holding: opp.holdingPeriod,
    buyNow: opp.buyNow, waitFor: opp.waitFor, reviewBy: opp.reviewBy ?? addDays(snap.asOf, 7),
    expiry: `Review by ${opp.reviewBy ?? addDays(snap.asOf, 7)} or sooner if price closes ${stop != null ? `below ${rs(stop)}` : "below support"}${breakout ? ` or above ${rs(breakout.price)}` : ""}. Re-run after each trading day; signals are based on the close of ${snap.asOf}.`,
  };

  // ---------- reasons (evidence with numbers) ----------
  const reasons: Reason[] = [];
  const ma = `Close ${rs(c)} vs 20-day ${rs(s20)}, 50-day ${rs(s50)}, 200-day ${rs(s200)}.`;
  reasons.push({ topic: "Trend", tone: snap.trend === "uptrend" ? "bull" : snap.trend === "downtrend" ? "bear" : "neutral", text: `${snap.trend === "uptrend" ? "Uptrend" : snap.trend === "downtrend" ? "Downtrend" : "Sideways"}. ${ma}${snap.adx != null ? ` ADX ${r2(snap.adx)} (${snap.adx >= 25 ? "a strong trend" : snap.adx >= 20 ? "a developing trend" : "weak or no trend"}).` : ""}` });
  reasons.push({ topic: "Market structure", tone: struct.tone, text: struct.label });
  if (sup[0]) reasons.push({ topic: "Support", tone: "neutral", text: `Nearest support ${rs(sup[0].price)} (${pc(sup[0].distancePct)} away, ${sup[0].strength}, ${sup[0].reactions} reactions, ${sup[0].tests} tests${sup[0].roleReversal ? ", old resistance turned support" : ""}).${strongSup && strongSup !== sup[0] ? ` Strongest support below: ${rs(strongSup.price)}.` : ""}` });
  if (res[0]) reasons.push({ topic: "Resistance", tone: "neutral", text: `Nearest resistance ${rs(res[0].price)} (${pc(res[0].distancePct)} away, ${res[0].strength}, ${res[0].reactions} reaction${res[0].reactions === 1 ? "" : "s"}).${strongRes && strongRes !== res[0] ? ` Strongest resistance above: ${rs(strongRes.price)}.` : ""}` });
  if (snap.rsi != null) { const r = snap.rsi; reasons.push({ topic: "RSI (14)", tone: r > 70 ? "bear" : r < 30 ? "bull" : r >= 55 ? "bull" : r <= 45 ? "bear" : "neutral", text: `RSI ${r2(r)}: ${r > 70 ? "overbought: strong buying, but late to chase; pullbacks are common from here" : r < 30 ? "oversold: selling is stretched; wait for a turn up before buying" : r >= 55 ? "bullish momentum zone (55-70)" : r <= 45 ? "weak momentum (below 45)" : "neutral (45-55)"}.${mfi != null ? ` Money Flow Index ${r2(mfi)}.` : ""}` }); }
  if (snap.macd.macd != null && snap.macd.signal != null) reasons.push({ topic: "MACD", tone: (h0 ?? 0) > 0 ? "bull" : "bear", text: `MACD ${r2(snap.macd.macd)} is ${snap.macd.macd > snap.macd.signal ? "above" : "below"} its signal ${r2(snap.macd.signal)}${snap.macd.cross ? ` (fresh ${snap.macd.cross} cross)` : ""}; histogram ${h0 != null ? r2(h0) : "-"} and ${h0 != null && h1 != null ? (h0 > h1 ? "rising (momentum improving)" : "falling (momentum fading)") : "flat"}. MACD is ${snap.macd.macd > 0 ? "above" : "below"} zero.` });
  const maTone: Tone = s50 != null && s200 != null ? (c > s50 && s50 > s200 ? "bull" : c < s50 && s50 < s200 ? "bear" : "neutral") : "neutral";
  reasons.push({ topic: "Moving averages", tone: maTone, text: `${opp.indicators.maPosition ?? "Mixed"}. Price is ${e20 != null ? (c > e20 ? "above" : "below") : "-"} the 20-day EMA${e20 != null ? ` (${rs(e20)})` : ""}${ema9 != null ? ` and ${c > ema9 ? "above" : "below"} the 9-day EMA (${rs(ema9)})` : ""}.` });
  reasons.push({ topic: "Volume", tone: (snap.volumeRatio ?? 0) >= 1.5 && c >= prev.close ? "bull" : (snap.volumeRatio ?? 0) >= 1.5 ? "bear" : "neutral", text: `Latest volume ${snap.volumeRatio ?? "-"}x its 20-day average${(snap.volumeRatio ?? 0) >= 1.5 ? " (confirms the move)" : (snap.volumeRatio ?? 0) < 0.8 ? " (low participation: moves are less reliable)" : ""}. Over 20 sessions, volume on up days was ${updown ?? "-"}x volume on down days${updown != null ? (updown > 1.2 ? " (accumulation)" : updown < 0.8 ? " (distribution)" : "") : ""}. OBV is ${snap.obvTrend ?? "-"}.` });
  if (lv.breakoutLevel || lv.breakdownLevel) reasons.push({ topic: "Breakout / breakdown", tone: "neutral", text: `${lv.breakoutLevel ? `Breakout trigger ${rs(lv.breakoutLevel)} (${pc(((lv.breakoutLevel - c) / c) * 100)} away)` : "No major resistance above"}; ${lv.breakdownLevel ? `breakdown trigger ${rs(lv.breakdownLevel)} (${pc(((lv.breakdownLevel - c) / c) * 100)} away)` : "no major support below"}. A close beyond either on high volume is the signal; intraday pokes don't count.` });
  for (const cd of candles.slice(0, 3)) reasons.push({ topic: "Candlestick", tone: cd.dir === "bullish" ? "bull" : cd.dir === "bearish" ? "bear" : "neutral", text: `${cd.name} on ${cd.date}: ${cd.note}` });
  for (const p of patterns.slice(0, 3)) reasons.push({ topic: "Chart pattern", tone: p.direction === "bullish" ? "bull" : p.direction === "bearish" ? "bear" : "neutral", text: `${p.name} (${p.status}, geometric quality ${p.confidence}/100). ${p.description}${p.target ? ` Measured target ${rs(p.target)}.` : ""}` });
  for (const d of divs) reasons.push({ topic: "Divergence", tone: d.dir === "bullish" ? "bull" : "bear", text: d.text });
  if (snap.supertrend.direction != null) reasons.push({ topic: "Supertrend / Ichimoku", tone: snap.supertrend.direction === 1 ? "bull" : "bear", text: `Supertrend (10, 3) is ${snap.supertrend.direction === 1 ? "bullish, trailing below at" : "bearish, capping above at"} ${rs(snap.supertrend.value)}. Price is ${snap.ichimoku.position ?? "-"} the Ichimoku cloud.` });
  if (snap.bollinger.percentB != null) reasons.push({ topic: "Bollinger Bands", tone: "neutral", text: `%B ${r2(snap.bollinger.percentB)} (0 = lower band ${rs(snap.bollinger.lower)}, 1 = upper band ${rs(snap.bollinger.upper)}).` });

  // ---------- risks & invalidation ----------
  const risks: string[] = [];
  if ((inp.avgTurnover20 ?? opp.avgTurnover ?? 0) < RULES.minTurnover * 3) risks.push(`Liquidity: average turnover ${rs(inp.avgTurnover20 ?? opp.avgTurnover)} a day. Large orders move the price; use limit orders.`);
  if ((snap.atrPct ?? 0) >= 4) risks.push(`High volatility: the average daily range is ${snap.atrPct}% of price.`);
  if (res[0] && res[0].distancePct < 3 && tone === "bull") risks.push(`Resistance ${rs(res[0].price)} is only ${res[0].distancePct}% above; the first target may be hard to clear.`);
  if ((snap.rsi ?? 50) > 70) risks.push("RSI is overbought: chasing here risks buying the top of a short-term move.");
  if (snap.trend === "downtrend" && tone === "bull") risks.push("The setup is against the primary downtrend; rallies in downtrends fail more often.");
  for (const f of fund?.redFlags ?? []) risks.push(`Fundamentals: ${f}`);
  if (opp.history && opp.history.trades >= 10 && (opp.history.avgNetPct ?? 0) < 0) risks.push(`Track record: past "${opp.setupType}" signals across NEPSE averaged ${pc(opp.history.avgNetPct)} after costs (${opp.history.trades} trades, ${opp.history.winRatePct}% profitable).`);
  for (const d of divs.filter((x) => x.dir === "bearish")) risks.push(d.text);
  risks.push("NEPSE has a ±10% daily circuit and no short selling; gaps through the stop are possible.");
  const invalidation = opp.invalidation.length ? [...opp.invalidation] : [];
  if (!invalidation.length && stop != null) invalidation.push(`A daily close below ${rs(stop)}.`);
  if (tone === "bull" && lv.breakdownLevel) invalidation.push(`Breakdown below ${rs(lv.breakdownLevel)} would turn the picture bearish.`);
  if (tone !== "bull" && s50 != null && c < s50) invalidation.push(`A close back above the 50-day average (${rs(s50)}) on volume would improve the outlook.`);

  // ---------- key levels for the chart ----------
  const levels: KeyLevel[] = [];
  if (sup[0]) levels.push({ kind: "Immediate support", price: r2(sup[0].price), low: r2(sup[0].low), high: r2(sup[0].high), why: sup[0].why, how: LEVEL_HOW, side: "support" });
  if (strongSup && strongSup !== sup[0]) levels.push({ kind: "Strong support", price: r2(strongSup.price), low: r2(strongSup.low), high: r2(strongSup.high), why: strongSup.why, how: LEVEL_HOW, side: "support" });
  if (res[0]) levels.push({ kind: "Immediate resistance", price: r2(res[0].price), low: r2(res[0].low), high: r2(res[0].high), why: res[0].why, how: LEVEL_HOW, side: "resistance" });
  if (strongRes && strongRes !== res[0]) levels.push({ kind: "Strong resistance", price: r2(strongRes.price), low: r2(strongRes.low), high: r2(strongRes.high), why: strongRes.why, how: LEVEL_HOW, side: "resistance" });
  if (lv.breakoutLevel) levels.push({ kind: "Breakout level", price: r2(lv.breakoutLevel), why: "Top of the strongest resistance zone above price: a close above it on volume is a breakout.", how: "Upper edge of the highest-scoring resistance cluster.", side: "trigger" });
  if (lv.breakdownLevel) levels.push({ kind: "Breakdown level", price: r2(lv.breakdownLevel), why: "Bottom of the strongest support zone below price: a close below it is a breakdown.", how: "Lower edge of the highest-scoring support cluster.", side: "trigger" });
  for (const d of lv.dynamic.slice(0, 4)) levels.push({ kind: d.name, price: r2(d.price), why: d.note, how: "Moving average or indicator value on the latest session (moves every day).", side: d.type });
  const zones = lv.zones.slice(0, 6).map((z) => ({ kind: z.kind, low: r2(z.low), high: r2(z.high), why: z.why, fresh: z.fresh }));

  // ---------- strategies ----------
  const strategies: Strategy[] = [];
  strategies.push({ key: "intraday", title: "Intraday", horizon: "Same day", available: false, stance: "Not available", tone: "neutral", entryLow: null, entryHigh: null, stop: null, targets: [], netRR: null, notes: ["NEPSE doesn't publish intraday candles for free, and the app only receives the last-traded price every 15 minutes during market hours. Without real intraday bars there is no honest intraday plan.", "Round-trip costs (about 0.8-1% plus 7.5% tax on gains) also make same-day trades hard to profit from."] });
  // Very short-term momentum (1-5 sessions)
  {
    const momOk = ema9 != null && c > ema9 && (snap.rsi ?? 0) >= 50 && (snap.rsi ?? 100) <= 72 && h0 != null && h1 != null && h0 > h1 && (snap.volumeRatio ?? 0) >= 1;
    const st = r2(Math.max(Math.min(last.low, prev.low), c - A));
    const t1 = r2(c + 1.5 * A), t2 = r2(c + 2.5 * A);
    const nr = netRR(c, st, t1, 5, fees).rr;
    const go = momOk && nr != null && nr >= 1.5;
    strategies.push({ key: "short", title: "Very short-term", horizon: "1-5 sessions", available: true, stance: go ? "Momentum buy" : "No edge", tone: go ? "bull" : "neutral", entryLow: go ? r2(c - 0.2 * A) : null, entryHigh: go ? r2(c + 0.2 * A) : null, stop: go ? st : null, targets: go ? [t1, t2] : [], netRR: nr,
      notes: go ? [`Price above the 9-day EMA, RSI ${r2(snap.rsi ?? 0)}, MACD histogram rising, volume at or above average.`, `Stop under the last two sessions' low or 1 ATR (${rs(A)}), targets 1.5 and 2.5 ATR.`, `Reward/risk after costs ${nr}.`]
        : [momOk ? `Momentum is there, but after costs the reward/risk to 1.5 ATR is only ${nr ?? "-"} (needs 1.5).` : "No short-term momentum setup: needs price above the 9-day EMA, RSI 50-72, rising MACD histogram and normal or higher volume.", "Very short trades in NEPSE are expensive: commission, SEBON fee and DP charge apply on both sides."] });
  }
  const swing = opp.horizon?.startsWith("swing") ? opp : null;
  const swingSetup: Setup | undefined = sig.setups.filter((s) => s.side === "buy" && s.horizon.startsWith("swing")).sort((a, b) => b.quality - a.quality)[0];
  if (swing && (opp.action === "BUY" || opp.action === "WATCH")) strategies.push({ key: "swing", title: "Swing trading", horizon: "1-4 weeks", available: true, stance: opp.action === "BUY" ? "Buy in the entry zone" : "Wait for entry", tone: opp.action === "BUY" ? "bull" : "neutral", entryLow: opp.entryLow, entryHigh: opp.entryHigh, stop: opp.stop, targets: opp.targets.map((t) => t.price), netRR: opp.netRiskReward, notes: [opp.headline, ...(opp.waitFor ? [`Wait for ${opp.waitFor}.`] : [])] });
  else if (swingSetup) strategies.push({ key: "swing", title: "Swing trading", horizon: "1-4 weeks", available: true, stance: swingSetup.quality >= RULES.buyMinQuality ? "Conditional" : "Weak setup", tone: "neutral", entryLow: swingSetup.entryLow, entryHigh: swingSetup.entryHigh, stop: swingSetup.stopLoss, targets: swingSetup.targets, netRR: netRR((swingSetup.entryLow + swingSetup.entryHigh) / 2, swingSetup.stopLoss, swingSetup.targets[0], 20, fees).rr, notes: [`${swingSetup.type} (quality ${swingSetup.quality}/100) did not pass all buy rules; use only if it strengthens.`, ...swingSetup.reasoning.slice(0, 2)] });
  else strategies.push({ key: "swing", title: "Swing trading", horizon: "1-4 weeks", available: true, stance: opp.action === "SELL" ? "Exit / avoid" : "No setup", tone: opp.action === "SELL" ? "bear" : "neutral", entryLow: null, entryHigh: null, stop: opp.action === "SELL" ? opp.stop : null, targets: [], netRR: null, notes: [opp.action === "SELL" ? opp.headline : "No breakout, pullback or momentum setup right now."] });
  // Positional: trend following around the 50-day average
  {
    const posSetup = sig.setups.filter((s) => s.side === "buy" && s.horizon.startsWith("positional")).sort((a, b) => b.quality - a.quality)[0];
    if (posSetup) strategies.push({ key: "positional", title: "Positional", horizon: "1-6 months", available: true, stance: posSetup.quality >= RULES.buyMinQuality ? "Buy in the entry zone" : "Conditional", tone: posSetup.quality >= RULES.buyMinQuality ? "bull" : "neutral", entryLow: posSetup.entryLow, entryHigh: posSetup.entryHigh, stop: posSetup.stopLoss, targets: posSetup.targets, netRR: netRR((posSetup.entryLow + posSetup.entryHigh) / 2, posSetup.stopLoss, posSetup.targets[0], 90, fees).rr, notes: [`${posSetup.type} (quality ${posSetup.quality}/100).`, ...posSetup.reasoning.slice(0, 2)] });
    else if (s50 != null && s200 != null && s50 > s200 && c > s200) {
      const lo = r2(Math.min(s50, c)), hi = r2(Math.max(s50 * 1.02, lo)), st = r2(Math.min(s200, strongSup?.low ?? s200) * 0.98);
      const tg = res.filter((x) => x.price > hi * 1.03).slice(0, 2).map((x) => r2(x.price));
      const nr = tg[0] ? netRR((lo + hi) / 2, st, tg[0], 90, fees).rr : null;
      strategies.push({ key: "positional", title: "Positional", horizon: "1-6 months", available: true, stance: c <= hi * 1.01 ? "Buy near the 50-day average" : "Buy on pullback", tone: "bull", entryLow: lo, entryHigh: hi, stop: st, targets: tg, netRR: nr, notes: [`Uptrend (50-day ${rs(s50)} above 200-day ${rs(s200)}). Positional buyers usually wait for pullbacks to the 50-day average.`, `Stop below the 200-day average / strong support, about ${r2(((((lo + hi) / 2) - st) / ((lo + hi) / 2)) * 100)}% risk.`] });
    } else strategies.push({ key: "positional", title: "Positional", horizon: "1-6 months", available: true, stance: snap.trend === "downtrend" ? "Avoid" : "Wait", tone: snap.trend === "downtrend" ? "bear" : "neutral", entryLow: null, entryHigh: null, stop: null, targets: [], netRR: null, notes: [snap.trend === "downtrend" ? `Below falling averages (50-day ${rs(s50)}, 200-day ${rs(s200)}): positional buying waits for a close above the 50-day average and a higher low.` : "No established trend to follow yet; wait for the 50-day average to rise above the 200-day."] });
  }
  // Long-term: business first
  {
    const f = fund;
    if (!f || f.score == null) strategies.push({ key: "long", title: "Long-term investing", horizon: "1+ years", available: false, stance: "Not enough data", tone: "neutral", entryLow: null, entryHigh: null, stop: null, targets: [], netRR: null, notes: ["No financial statements are stored for this company yet, so no long-term view is given."] });
    else {
      const good = f.score >= 65 && f.redFlags.length === 0, weak = f.score < 45 || f.redFlags.length >= 2;
      const zoneLo = strongSup ? r2(strongSup.low) : null, zoneHi = s200 != null ? r2(Math.max(s200, zoneLo ?? 0)) : null;
      const notes = [`Fundamental score ${f.score}/100${f.period ? ` (${f.period})` : ""}.`];
      if (f.pe != null && f.pe > 0) notes.push(`P/E ${r2(f.pe)}${f.sectorPe ? ` vs sector median ${r2(f.sectorPe)}` : ""}${f.pb != null ? `, P/B ${r2(f.pb)}` : ""}${f.roe != null ? `, ROE ${r2(f.roe)}%` : ""}.`);
      if (f.graham != null && f.graham > 0) notes.push(`Graham number ${rs(f.graham)} (a conservative value ceiling): price is ${pc(((c - f.graham) / f.graham) * 100, 0)} vs it.`);
      if (f.dividendYears5 != null) notes.push(`Paid dividends in ${f.dividendYears5} of the last 5 years${f.cashYield != null ? `; cash yield ${r2(f.cashYield)}%` : ""}.`);
      for (const s of f.strengths.slice(0, 2)) notes.push(s);
      for (const s of f.redFlags.slice(0, 2)) notes.push(`Caution: ${s}`);
      notes.push(good ? "Buy in parts (e.g. monthly) rather than all at once; long-term holders don't use tight stops but should review after each quarterly report." : weak ? "The business numbers don't support a long-term holding right now." : "Mixed business quality: only a small position, if any, and review each quarter.");
      strategies.push({ key: "long", title: "Long-term investing", horizon: "1+ years", available: true, stance: good ? (snap.trend === "downtrend" ? "Accumulate slowly" : "Accumulate") : weak ? "Avoid" : "Selective", tone: good ? "bull" : weak ? "bear" : "neutral", entryLow: good ? zoneLo : null, entryHigh: good ? zoneHi : null, stop: null, targets: [], netRR: null, notes });
    }
  }

  // ---------- assessments ----------
  const tech = snap.technicalScore;
  const shortReasons = [`Technical score ${tech}/100.`, opp.headline];
  const trendPts = s50 != null && s200 != null ? (c > s50 && s50 > s200 ? 80 : c < s50 && s50 < s200 ? 20 : 50) : 50;
  const medScore = fund?.score != null ? 0.5 * trendPts + 0.5 * fund.score : null;
  const medReasons = [`Trend: ${opp.indicators.maPosition ?? snap.trend}.`, fund?.score != null ? `Fundamental score ${fund.score}/100.` : "No stored statements."];
  if (fund?.profitGrowth != null) medReasons.push(`Profit ${fund.profitGrowth >= 0 ? "grew" : "fell"} ${Math.abs(r2(fund.profitGrowth))}% year on year.`);
  let longScore: number | null = null;
  const longReasons: string[] = [];
  if (fund?.score != null) {
    longScore = fund.score * 0.75 + (fund.dividendYears5 != null ? (fund.dividendYears5 / 5) * 15 : 7) + (fund.pe != null && fund.sectorPe ? (fund.pe < fund.sectorPe ? 10 : fund.pe > fund.sectorPe * 1.5 ? 0 : 5) : 5) - fund.redFlags.length * 8;
    longReasons.push(`Business quality ${fund.score}/100 (profitability, growth, balance sheet and valuation in the ${fund.sectorGroup ?? "sector"} model).`);
    if (fund.dividendYears5 != null) longReasons.push(`Dividends in ${fund.dividendYears5}/5 years.`);
    if (fund.redFlags.length) longReasons.push(`${fund.redFlags.length} red flag(s): ${fund.redFlags.slice(0, 2).join("; ")}.`);
    longReasons.push("A strong chart alone doesn't make a good long-term investment; this view uses the business numbers.");
  } else longReasons.push("No financial statements stored, so long-term suitability can't be judged.");
  const assessments = { short: assess(tech + (tone === "bull" ? 5 : tone === "bear" ? -10 : 0), shortReasons), medium: assess(medScore, medReasons), long: assess(longScore, longReasons) };

  // ---------- scanner tags ----------
  const tags: string[] = [], tagNotes: Record<string, string> = {};
  const tag = (k: string, note: string) => { tags.push(k); tagNotes[k] = note; };
  if (verdict === "BUY" || verdict === "STRONG BUY") tag("buy", `${verdict}: ${opp.setupType ?? "setup"}, R:R ${opp.riskReward ?? "-"} (${opp.netRiskReward ?? "-"} after costs).`);
  if (sup[0] && Math.abs(sup[0].distancePct) <= 2.5 && sup[0].price < c && (sup[0].strength === "major" || sup[0].reactions >= 3)) tag("near-support", `${Math.abs(sup[0].distancePct)}% above support ${rs(sup[0].price)} (${sup[0].reactions} reaction${sup[0].reactions === 1 ? "" : "s"}).`);
  if (res[0] && res[0].distancePct <= 2.5 && (res[0].strength === "major" || res[0].reactions >= 3)) tag("near-resistance", `${res[0].distancePct}% below resistance ${rs(res[0].price)}.`);
  const bo = patterns.find((p) => p.name === "Breakout" && p.endDate >= bars[Math.max(0, n - 3)].date);
  if (bo) tag("breakout", `${bo.description}${(snap.volumeRatio ?? 0) >= 1.5 ? " Volume confirms." : " Volume not yet confirming."}`);
  else if (lv.breakoutLevel && (lv.breakoutLevel - c) / c <= 0.03 && (snap.rsi ?? 0) >= 50) tag("breakout", `Within ${r2(((lv.breakoutLevel - c) / c) * 100)}% of the breakout level ${rs(lv.breakoutLevel)} with RSI ${r2(snap.rsi ?? 0)}.`);
  if ((snap.return1m ?? 0) >= 8 && (snap.rsi ?? 0) >= 55 && (snap.rsi ?? 0) <= 78 && snap.trend === "uptrend") tag("momentum", `${pc(snap.return1m)} in a month, RSI ${r2(snap.rsi ?? 0)}, uptrend${snap.adx != null ? `, ADX ${r2(snap.adx)}` : ""}.`);
  if ((snap.rsi ?? 50) < 30 || (mfi != null && mfi < 20)) tag("oversold", `RSI ${r2(snap.rsi ?? 0)}${mfi != null ? `, MFI ${r2(mfi)}` : ""}: stretched to the downside (not a buy until it turns).`);
  if ((snap.rsi ?? 50) > 70) tag("overbought", `RSI ${r2(snap.rsi ?? 0)}: stretched to the upside.`);
  const bullRev = divs.find((d) => d.dir === "bullish") ?? (sup[0] && Math.abs(sup[0].distancePct) <= 4 ? candles.find((x) => x.dir === "bullish") : undefined);
  const bearRev = divs.find((d) => d.dir === "bearish") ?? (res[0] && res[0].distancePct <= 4 ? candles.find((x) => x.dir === "bearish") : undefined);
  if (bullRev) tag("reversal-up", "text" in bullRev ? bullRev.text : `${bullRev.name} near support ${rs(sup[0]?.price)}.`);
  if (bearRev) tag("reversal-down", "text" in bearRev ? bearRev.text : `${bearRev.name} near resistance ${rs(res[0]?.price)}.`);
  if ((snap.volumeRatio ?? 0) >= 2) tag("volume-spike", `Volume ${snap.volumeRatio}x average on a ${c >= prev.close ? "rising" : "falling"} close.`);
  const gcEv = recentEvents(bars, snap, [], [], []).find((e) => /Golden cross|Death cross/.test(e.text));
  if (gcEv) tag(gcEv.text.startsWith("Golden") ? "golden-cross" : "death-cross", `${gcEv.text} (${gcEv.date})`);

  const out: ChartAnalysis = {
    ...base, verdict, tone, headline, confidence: opp.confidence, confidenceLabel: opp.confidenceLabel,
    plan, reasons, risks, invalidation, levels, zones, strategies, assessments,
    events: recentEvents(bars, snap, patterns, candles, divs).slice(0, 25),
    indicators: { rsi: snap.rsi, macd: snap.macd.macd, macdSignal: snap.macd.signal, macdHist: snap.macd.histogram, adx: snap.adx, atr: snap.atr, atrPct: snap.atrPct, volumeRatio: snap.volumeRatio, sma20: s20, sma50: s50, sma200: s200, ema20: e20, ema9, mfi, stochK: snap.stochastic.k, percentB: snap.bollinger.percentB, high52: snap.high52, low52: snap.low52, return1m: snap.return1m, return3m: snap.return3m, return1y: snap.return1y, upDownVolume: updown },
    scores: { technical: tech, fundamental: fund?.score ?? null }, tags, tagNotes,
  };
  out.orders = tradeOrders(out, sup[0]?.price ?? null, res.filter((r) => r.price > c)[0]?.price ?? null, tradingWeekdays(bars.map((b) => b.date)));
  return out;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** The weekdays NEPSE actually traded on recently (the week changed from Sun-Thu to Mon-Fri in 2026), read from the price data. */
export function tradingWeekdays(dates: string[]) {
  const recent = dates.slice(-40), n = new Map<number, number>();
  for (const d of recent) n.set(wd(d), (n.get(wd(d)) ?? 0) + 1);
  const days = [...n.entries()].filter(([, k]) => k >= 3).map(([w]) => w).sort();
  return days.length >= 4 ? days : [0, 1, 2, 3, 4];
}
/** Next trading session after a date (11:00 to 15:00 Nepal time), skipping known NEPSE closures. */
export function nextSession(asOf: string, days: number[] = [0, 1, 2, 3, 4]) {
  let d = addDays(asOf, 1);
  for (let i = 0; i < 30 && (!days.includes(wd(d)) || closureOn(d)); i++) d = addDays(d, 1);
  return d;
}
const closedDays = (days: number[]) => DOW.filter((_, i) => !days.includes(i)).map((x) => `${x}s`).join(" and ");
export const sessionLabel = (d: string) => `${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d}, 11:00 AM-3:00 PM`;
const pct = (from: number, to: number) => `${to >= from ? "+" : ""}${(((to - from) / from) * 100).toFixed(1)}%`;

/** Plain, exact instructions: what to buy or sell, at which prices, and when. Built only from the plan above. */
export function tradeOrders(a: ChartAnalysis, nearSup: number | null, nearRes: number | null, days: number[] = [0, 1, 2, 3, 4]): TradeOrders | undefined {
  const p = a.plan, c = a.price;
  if (!a.asOf || c == null) return undefined;
  const next = nextSession(a.asOf, days), when = sessionLabel(next);
  const t = p.targets, stop = p.stop;
  const sellSteps = (ref: number): OrderStep[] => [
    ...(t[0] ? [{ kind: "sell" as const, title: `SELL half at Rs. ${r2(t[0].price)}`, text: `Place a sell order for half your shares at Rs. ${r2(t[0].price)} (${pct(ref, t[0].price)} from Rs. ${r2(ref)}). ${t[0].basis}.`, price: t[0].price }] : []),
    ...(t[1] ? [{ kind: "sell" as const, title: `SELL the rest at Rs. ${r2(t[1].price)}`, text: `Sell the remaining shares at Rs. ${r2(t[1].price)} (${pct(ref, t[1].price)}). After the first sale, move your stop up to your buy price so the trade can't turn into a loss.`, price: t[1].price }] : []),
    ...(stop != null ? [{ kind: "stop" as const, title: `STOP-LOSS: sell everything if a day closes below Rs. ${r2(stop)}`, text: `If any trading day closes below Rs. ${r2(stop)} (${pct(ref, stop)}), sell all shares at the next session's open. ${p.stopWhy ?? ""}`.trim(), price: stop }] : []),
  ];
  const validUntil = `${p.reviewBy ?? addDays(a.asOf, 7)} (based on the close of ${a.asOf})`;
  const v = a.verdict;
  if ((v === "BUY" || v === "STRONG BUY") && p.entryLow != null && p.entryHigh != null) {
    const mid = (p.entryLow + p.entryHigh) / 2;
    return {
      action: v, session: when, validUntil,
      summary: `${v}: buy ${a.symbol} between Rs. ${r2(p.entryLow)} and Rs. ${r2(p.entryHigh)} on ${when}. Do not pay more than Rs. ${r2(p.entryHigh)}.`,
      forBuyers: [
        { kind: "buy", title: `BUY between Rs. ${r2(p.entryLow)} and Rs. ${r2(p.entryHigh)}`, text: `On ${when}, place a limit buy order at or below Rs. ${r2(p.entryHigh)}${c > p.entryHigh ? ` (today's close Rs. ${r2(c)} is above it, so wait for the price to come back)` : ""}. If it opens above Rs. ${r2(p.entryHigh * 1.01)}, skip the trade: chasing ruins the risk/reward.`, low: p.entryLow, high: p.entryHigh },
        ...sellSteps(mid),
        { kind: "wait", title: `TIME LIMIT: ${p.holding ?? "review weekly"}`, text: `If neither the target nor the stop is reached by ${p.reviewBy ?? addDays(a.asOf, 7)}, re-check the chart; sell if the reason for the trade has gone.` },
      ],
      forHolders: [{ kind: "hold", title: "HOLD", text: `Keep holding while the price stays above Rs. ${stop != null ? r2(stop) : "the stop"}; take profit with the sell steps above.` }],
      note: `Orders are for the next trading session; NEPSE is closed on ${closedDays(days)} and public holidays.`,
    };
  }
  if (v === "SELL" || v === "STRONG SELL") {
    const reb = nearRes ?? (c * 1.03);
    return {
      action: v, session: when, validUntil,
      summary: `${v}: don't buy ${a.symbol}. If you own it, sell on ${when} near Rs. ${r2(c)}, or on a bounce up to Rs. ${r2(reb)}.`,
      forBuyers: [{ kind: "avoid", title: "DON'T BUY", text: `The trend is down. Don't buy until a day closes above Rs. ${r2(p.breakout?.price ?? reb)} with strong volume.`, price: p.breakout?.price ?? reb }],
      forHolders: [
        { kind: "sell", title: `SELL at Rs. ${r2(c)} or on a bounce to Rs. ${r2(reb)}`, text: `On ${when}, sell at or above Rs. ${r2(c * 0.99)}; or place a sell order at Rs. ${r2(reb)} (${pct(c, reb)}, the nearest resistance) for this week.`, price: reb },
        ...(nearSup != null ? [{ kind: "stop" as const, title: `Sell everything if a day closes below Rs. ${r2(nearSup)}`, text: `Below the nearest support (Rs. ${r2(nearSup)}, ${pct(c, nearSup)}) the fall can speed up.`, price: nearSup }] : []),
      ],
      note: "A sell view is for people who own the stock; this app never suggests short selling.",
    };
  }
  // WAIT / HOLD / NO SIGNAL: exact conditions that would turn into a buy.
  const z = p.bestZone, br = p.breakout;
  const forBuyers: OrderStep[] = [{ kind: "wait", title: `DON'T BUY NOW at Rs. ${r2(c)}`, text: `${a.headline} There is no good entry at today's price.` }];
  if (z && c <= z.high && c >= z.low) {
    const top = r2(Math.min(z.high, c));
    forBuyers.push({ kind: "buy", title: `BUY ZONE: Rs. ${r2(z.low)}-${top} (price is in it now)`, text: `Today's close is inside the buy zone. Only buy with a limit order between Rs. ${r2(z.low)} and Rs. ${top}, and only while days close above Rs. ${r2(z.low)} (the support is holding).${stop != null && stop < z.low ? ` Stop-loss: sell if a day closes below Rs. ${r2(stop)} (${pct(top, stop)}).` : ""}${t[0] && t[0].price > top ? ` First target Rs. ${r2(t[0].price)} (${pct(top, t[0].price)}).` : ""} The verdict is still ${v} because: ${a.headline.replace(/\.$/, "")}.`, low: z.low, high: top });
  } else if (z && z.high < c) forBuyers.push({ kind: "buy", title: `BUY ON A DIP: Rs. ${r2(z.low)}-${r2(z.high)}`, text: `If the price falls to Rs. ${r2(z.low)}-${r2(z.high)} (${pct(c, z.high)} from today) and a day closes back above Rs. ${r2(z.low)}, buy at the next session up to Rs. ${r2(z.high)}.${stop != null && stop < z.low ? ` Stop-loss: sell if a day closes below Rs. ${r2(stop)} (${pct(z.high, stop)}).` : ""}${t[0] && t[0].price > z.high ? ` First target Rs. ${r2(t[0].price)} (${pct(z.high, t[0].price)}).` : ""}`, low: z.low, high: z.high });
  if (br) forBuyers.push({ kind: "buy", title: `BUY ON A BREAKOUT: close above Rs. ${r2(br.price)}`, text: `If a day closes above Rs. ${r2(br.price)} (${pct(c, br.price)}) on at least 1.5x average volume, buy at the next session up to Rs. ${r2(br.price * 1.02)}. Stop-loss: a close back below Rs. ${r2(br.price * 0.97)}.${t.find((x) => x.price > br.price * 1.02) ? ` Target Rs. ${r2(t.find((x) => x.price > br.price * 1.02)!.price)}.` : ""}`, price: br.price });
  const forHolders: OrderStep[] = [
    { kind: "hold", title: stop != null ? `HOLD while above Rs. ${r2(stop)}` : "HOLD", text: `Keep the shares while daily closes stay above Rs. ${stop != null ? r2(stop) : r2(nearSup ?? c * 0.93)}.` },
    ...(t[0] ? [{ kind: "sell" as const, title: `TAKE PROFIT on part at Rs. ${r2(t[0].price)}`, text: `Sell part of your holding at Rs. ${r2(t[0].price)} (${pct(c, t[0].price)}), the next resistance.`, price: t[0].price }] : []),
    ...(stop != null ? [{ kind: "stop" as const, title: `SELL if a day closes below Rs. ${r2(stop)}`, text: `Sell at the next session's open if a day closes below Rs. ${r2(stop)} (${pct(c, stop)}).`, price: stop }] : []),
  ];
  return {
    action: v === "NO SIGNAL" ? "NO SIGNAL" : v, session: when, validUntil, forBuyers, forHolders,
    summary: `${v === "HOLD" ? "HOLD" : "WAIT"}: don't buy ${a.symbol} at Rs. ${r2(c)} now.${z ? (c <= z.high ? ` Buy only between Rs. ${r2(z.low)} and Rs. ${r2(Math.min(z.high, c))} while support holds` : ` Buy on a dip to Rs. ${r2(z.low)}-${r2(z.high)}`) : ""}${z && br ? " or" : ""}${br ? ` after a close above Rs. ${r2(br.price)}` : ""}${z || br ? "." : ""}`,
    note: "Check again after each trading day: the conditions are judged on closing prices.",
  };
}

/** Compact text summary passed to the language model (never the raw bars). */
export function summaryForAI(a: ChartAnalysis): string {
  const L = (s: string) => s;
  const lines = [
    `Stock: ${a.symbol} (${a.name}, ${a.sector}). Data: daily bars to ${a.asOf}; last close ${rs(a.price)} (${pc(a.changePct)}).`,
    `Engine verdict: ${a.verdict} (confidence ${a.confidence} ${a.confidenceLabel}). ${a.headline}`,
    `Plan: entry ${rs(a.plan.entryLow)}-${rs(a.plan.entryHigh)}, best zone ${a.plan.bestZone ? `${rs(a.plan.bestZone.low)}-${rs(a.plan.bestZone.high)}` : "-"}, breakout ${rs(a.plan.breakout?.price)}, stop ${rs(a.plan.stop)}, targets ${a.plan.targets.map((t) => rs(t.price)).join(", ") || "-"}, R:R ${a.plan.riskReward ?? "-"} (after costs ${a.plan.netRiskReward ?? "-"}), holding ${a.plan.holding ?? "-"}.`,
    `Levels: ${a.levels.map((l) => `${l.kind} ${rs(l.price)}`).join("; ")}.`,
    `Zones: ${a.zones.map((z) => `${z.kind} ${rs(z.low)}-${rs(z.high)}${z.fresh ? " (fresh)" : ""}`).join("; ") || "none"}.`,
    `Indicators: ${Object.entries(a.indicators).filter(([, v]) => v != null).map(([k, v]) => `${k} ${r2(v as number)}`).join(", ")}.`,
    "Evidence:", ...a.reasons.map((r) => `- [${r.topic}] ${r.text}`),
    `Recent events: ${a.events.slice(0, 10).map((e) => `${e.date} ${e.text}`).join(" | ") || "none"}.`,
    `Risks: ${a.risks.join(" | ")}`,
    `Invalidation: ${a.invalidation.join(" | ")}`,
    `Strategies: ${a.strategies.map((s) => `${s.title}: ${s.stance}${s.entryLow != null ? ` entry ${rs(s.entryLow)}-${rs(s.entryHigh)}` : ""}${s.stop != null ? ` stop ${rs(s.stop)}` : ""}${s.targets.length ? ` targets ${s.targets.map(rs).join("/")}` : ""}`).join(" | ")}`,
    `Assessments: short-term ${a.assessments.short.label} (${a.assessments.short.score ?? "-"}), medium-term ${a.assessments.medium.label} (${a.assessments.medium.score ?? "-"}), long-term ${a.assessments.long.label} (${a.assessments.long.score ?? "-"}). Long-term notes: ${a.assessments.long.reasons.join(" ")}`,
    a.history ? `This stock's own past BUY signals (walk-forward, after costs): ${a.history.trades} trades, ${a.history.winRatePct ?? "-"}% profitable, average ${pc(a.history.avgNetPct)}.` : "",
    a.dataNotes.join(" "),
  ];
  return lines.filter(Boolean).map(L).join("\n");
}

// ---------- rule-based chart Q&A (works without an AI key) ----------
const has = (q: string, ...re: RegExp[]) => re.some((r) => r.test(q));

export function answerChart(question: string, a: ChartAnalysis): string {
  const q = question.toLowerCase();
  const p = a.plan, sup = a.levels.filter((l) => l.side === "support" && /support/i.test(l.kind)), res = a.levels.filter((l) => l.side === "resistance" && /resistance/i.test(l.kind));
  const ev = (topic: string) => a.reasons.find((r) => r.topic === topic)?.text;
  const out: string[] = [];
  const verdictLine = `**${a.symbol}: ${a.verdict}** (confidence ${a.confidence}/100, ${a.confidenceLabel}). ${a.headline}`;
  if (a.verdict === "NO SIGNAL" && !a.reasons.length) return `${verdictLine}\n\nThere isn't enough reliable price history to analyse this chart.`;
  if (has(q, /beginner|simple|explain.*(chart|like)|eli5|layman/)) {
    out.push(`In plain words: ${a.symbol} closed at ${rs(a.price)} on ${a.asOf}.`);
    out.push(`• **Direction:** ${ev("Trend")?.split(".")[0]}. ${a.structure.tone === "bull" ? "Each dip has stopped higher than the last, a healthy sign." : a.structure.tone === "bear" ? "Each bounce has stopped lower than the last, a weak sign." : "Price is moving sideways."}`);
    if (sup[0]) out.push(`• **Floor (support):** around ${rs(sup[0].price)}, where buyers stepped in before.`);
    if (res[0]) out.push(`• **Ceiling (resistance):** around ${rs(res[0].price)}, where sellers appeared before.`);
    out.push(`• **Momentum (RSI ${a.indicators.rsi != null ? r2(a.indicators.rsi) : "-"}):** ${a.indicators.rsi == null ? "-" : a.indicators.rsi > 70 ? "it has risen fast and may need a rest" : a.indicators.rsi < 30 ? "it has fallen fast and may bounce, but wait for proof" : "neither stretched up nor down"}.`);
    out.push(`• **What the app suggests:** ${a.verdict}. ${p.entryLow != null ? `A sensible buy range is ${rs(p.entryLow)}-${rs(p.entryHigh)} with a stop-loss at ${rs(p.stop)} (the price where you admit you were wrong and sell).` : p.waitFor ? `Wait for ${p.waitFor}.` : ""}`);
    out.push("Only risk money you can afford to lose, and never put everything into one stock.");
    return out.join("\n");
  }
  if (has(q, /similar|previous|past|history|before|track record|worked/)) {
    if (a.history && a.history.trades) {
      out.push(`When the app's BUY rule fired on ${a.symbol} in the past (replayed day by day without hindsight, after all costs): **${a.history.trades} trades, ${a.history.winRatePct}% profitable, average ${pc(a.history.avgNetPct)}**; target hit ${a.history.targetHitPct ?? "-"}%, stop hit ${a.history.stopHitPct ?? "-"}%.`);
      for (const t of a.history.recent.slice(0, 5)) out.push(`• ${t.date}: ${t.type} > ${t.outcome}, ${pc(t.netPct)}`);
    } else out.push(`The BUY rule hasn't fired on ${a.symbol} in the replay window, so there are no comparable past setups for this stock.`);
    if (a.setupHistory && a.setupHistory.trades) out.push(`Across all NEPSE stocks, "${a.headline.split(":")[0]}" signals: ${a.setupHistory.trades} trades, ${a.setupHistory.winRatePct}% profitable, average ${pc(a.setupHistory.avgNetPct)} after costs.`);
    out.push("Past results don't guarantee future ones; they show how reliable this kind of signal has been.");
    return out.join("\n");
  }
  if (has(q, /stop.?loss|\bstop\b|where.*(exit|cut)|protect/)) {
    out.push(p.stop != null ? `**Stop-loss: ${rs(p.stop)}** (${a.price ? pc(((p.stop - a.price) / a.price) * 100) : ""} from the last close). ${p.stopWhy ?? ""}` : "No stop is set because there's no active trade setup.");
    if (sup[0]) out.push(`The nearest support is ${rs(sup[0].price)}; a stop just under the support zone (not exactly on it) avoids being shaken out by normal noise.`);
    out.push(`Use a daily close below the stop as the exit signal. NEPSE can gap, so size the position so that a loss at the stop is at most 1-2% of your capital (the Trade Planner below does this).`);
    return out.join("\n");
  }
  if (has(q, /false breakout|genuine|real breakout|fake/)) {
    const bo = a.patterns.find((x) => x.name === "Breakout"), vr = a.indicators.volumeRatio ?? 0;
    if (bo) {
      out.push(`A breakout above ${rs(bo.keyLevel)} happened (${bo.endDate}). Checks:`);
      out.push(`• Close above the level: ${a.price != null && bo.keyLevel != null && a.price > bo.keyLevel ? `yes (${pc(((a.price - bo.keyLevel) / bo.keyLevel) * 100)})` : "no, price is back below, a failed breakout so far"}.`);
      out.push(`• Volume: ${vr}x average ${vr >= 1.5 ? "(confirms)" : "(weak: breakouts on low volume fail more often)"}.`);
      out.push(`• RSI ${a.indicators.rsi != null ? r2(a.indicators.rsi) : "-"} ${(a.indicators.rsi ?? 0) > 75 ? "(very stretched: a pullback to the level is likely)" : ""}.`);
      out.push(`It becomes a false breakout if price closes back below ${rs(bo.keyLevel)}. A retest that holds above the level is the strongest confirmation.`);
    } else if (p.breakout) out.push(`No breakout yet. The level to watch is ${rs(p.breakout.price)}. ${p.breakout.why} Breakouts that close back below the level within 2-3 sessions are false.`);
    else out.push("There's no breakout in progress and no nearby major resistance to break.");
    return out.join("\n");
  }
  if (has(q, /volume|participation|accumulat|distribut/)) { out.push(ev("Volume") ?? "No volume data."); if (a.tags.includes("volume-spike")) out.push(a.tagNotes["volume-spike"]); out.push((a.indicators.volumeRatio ?? 0) >= 1.5 ? "Volume is confirming the latest move." : "Volume isn't strongly confirming the latest move; treat it with more caution."); return out.join("\n"); }
  if (has(q, /break.*support|below support|support.*break|what happens if|downside|how low|fall/)) {
    out.push(sup[0] ? `If ${rs(sup[0].price)} breaks on a closing basis, ${sup[1] ? `the next support is ${rs(sup[1].price)} (${a.price ? pc(((sup[1].price - a.price) / a.price) * 100) : ""})` : "there's no strong support close below; the fall could extend"}.` : "No clear support was found below the current price.");
    const bd = a.levels.find((l) => l.kind === "Breakdown level"); if (bd) out.push(`A close below the breakdown level ${rs(bd.price)} would turn the outlook bearish. ${bd.why}`);
    out.push(`Invalidation of the current view: ${a.invalidation.join(" ")}`);
    return out.join("\n");
  }
  if (has(q, /resistance|target|upside|how high|sell.*price|take profit|next level/)) {
    if (p.targets.length) out.push(`**Targets:** ${p.targets.map((t, i) => `T${i + 1} ${rs(t.price)} (${pc(t.pct)}), ${t.basis}`).join("; ")}.`);
    if (res.length) out.push(`**Resistance above:** ${res.map((r) => `${r.kind.toLowerCase()} ${rs(r.price)}`).join(", ")}. ${res[0].why}`);
    else out.push("No resistance above from past price action (price is near its highs); targets use ATR multiples instead.");
    out.push("Taking partial profit at T1 and moving the stop to breakeven is a common way to protect gains.");
    return out.join("\n");
  }
  if (has(q, /support|safest|buying zone|demand|floor/)) {
    if (p.bestZone) out.push(`**Best buying zone: ${rs(p.bestZone.low)}-${rs(p.bestZone.high)}.** ${p.bestZone.why}`);
    for (const s of sup) out.push(`• ${s.kind} ${rs(s.price)}${s.low != null ? ` (zone ${rs(s.low)}-${rs(s.high)})` : ""}: ${s.why}`);
    const dz = a.zones.filter((z) => z.kind === "demand"); if (dz.length) out.push(`Demand zones: ${dz.map((z) => `${rs(z.low)}-${rs(z.high)}${z.fresh ? " (fresh)" : ""}`).join(", ")}.`);
    out.push("The safest entries are near strong support with a stop just below it, after a sign of buyers (a bullish candle or rising volume).");
    return out.join("\n");
  }
  if (has(q, /long.?term|invest|hold for|years|fundamental|dividend/)) {
    const lt = a.strategies.find((s) => s.key === "long");
    out.push(`**Long-term: ${a.assessments.long.label}${a.assessments.long.score != null ? ` (${a.assessments.long.score}/100)` : ""}.** ${lt?.stance ?? ""}`);
    for (const r of lt?.notes ?? a.assessments.long.reasons) out.push(`• ${r}`);
    out.push(`Short-term trading view for comparison: ${a.assessments.short.label}. A good chart doesn't make a good long-term investment, and vice versa.`);
    return out.join("\n");
  }
  if (has(q, /change|invalidat|wrong|cancel|flip/)) { out.push("The view changes if:"); for (const x of a.invalidation) out.push(`• ${x}`); out.push(`• ${p.expiry}`); return out.join("\n"); }
  if (has(q, /wait|correction|now or|pullback|dip/)) {
    out.push(verdictLine);
    if (p.buyNow === "now") out.push(`Price is inside the entry zone ${rs(p.entryLow)}-${rs(p.entryHigh)} with volume confirming, so buying now (in that range) fits the plan.`);
    else if (p.waitFor) out.push(`**Wait** for ${p.waitFor}.`);
    if (p.bestZone && a.price && a.price > p.bestZone.high * 1.02) out.push(`Price is ${pc(((a.price - p.bestZone.high) / p.bestZone.high) * 100)} above the best zone (${rs(p.bestZone.low)}-${rs(p.bestZone.high)}); a pullback gives a better reward/risk.`);
    return out.join("\n");
  }
  if (has(q, /\brsi\b|overbought|oversold/)) return ev("RSI (14)") ?? "RSI unavailable.";
  if (has(q, /macd/)) return ev("MACD") ?? "MACD unavailable.";
  if (has(q, /trend|direction|moving average|\bma\b/)) return [ev("Trend"), ev("Moving averages"), a.structure.label].filter(Boolean).join("\n");
  if (has(q, /pattern|candle|formation|triangle|flag|wedge|head|double/)) { const pts = a.reasons.filter((r) => r.topic === "Chart pattern" || r.topic === "Candlestick" || r.topic === "Divergence"); return pts.length ? pts.map((r) => `• ${r.text}`).join("\n") : "No clear chart, candlestick or divergence pattern on the latest sessions."; }
  // Default: "should I buy now?", "good entry?", "worth buying?" and anything else
  out.push(verdictLine);
  if (p.entryLow != null) out.push(`• **Entry:** ${rs(p.entryLow)}-${rs(p.entryHigh)}${p.buyNow === "now" ? " (price is in range now)" : p.waitFor ? `, wait for ${p.waitFor}` : ""}.`);
  if (p.breakout) out.push(`• **Breakout entry:** above ${rs(p.breakout.price)} on volume.`);
  if (p.stop != null) out.push(`• **Stop-loss:** ${rs(p.stop)}.`);
  if (p.targets.length) out.push(`• **Targets:** ${p.targets.map((t) => rs(t.price)).join(", ")}${p.riskReward ? ` (R:R ${p.riskReward}, ${p.netRiskReward ?? "-"} after costs)` : ""}.`);
  out.push("**Why:**");
  for (const r of a.reasons.filter((x) => x.tone !== "neutral").slice(0, 5)) out.push(`• ${r.text}`);
  if (a.risks.length) out.push(`**Main risk:** ${a.risks[0]}`);
  return out.join("\n");
}
