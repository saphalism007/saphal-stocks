// Trading Opportunities: one decision per stock (BUY / SELL / HOLD / WATCH / AVOID, or
// "Insufficient data"), built only from stored prices, the rule-based setups, support/resistance
// and fundamentals. Long-term investment ideas are judged separately from trades.
// Nothing here predicts prices: every level comes from the price history and every signal
// lists its reasons, what would invalidate it and when to review it. Pure and tested.
import type { Bar } from "./types.ts";
import { generateSetups, type Setup } from "./signals.ts";
import { roundTrip, type FeeConfig, DEFAULT_FEES } from "./costs.ts";

export type Action = "BUY" | "SELL" | "HOLD" | "WATCH" | "AVOID" | "INSUFFICIENT";
export type Bucket = "buy" | "sell" | "hold" | "watch" | "avoid" | "insufficient";

export interface FundamentalInput { score: number | null; valuationScore: number | null; redFlags: string[]; strengths: string[]; pe: number | null; pb: number | null; roe: number | null; cashYield: number | null; yearsPaid5: number | null; period: string | null }

export interface Opportunity {
  symbol: string; name: string; sector: string;
  price: number | null; priceDate: string | null;
  action: Action; bucket: Bucket; headline: string;
  setupType: string | null; horizon: string | null; holdingPeriod: string | null;
  entryLow: number | null; entryHigh: number | null; entry: number | null; stop: number | null;
  targets: { price: number; basis: string }[]; riskReward: number | null; riskPct: number | null;
  buyNow: "now" | "wait" | null; waitFor: string | null;
  techReasons: string[]; fundReasons: string[];
  supports: number[]; resistances: number[];
  indicators: { rsi: number | null; macd: string | null; trend: string | null; adx: number | null; sma20: number | null; sma50: number | null; sma200: number | null; maPosition: string | null; volumeRatio: number | null; volumeConfirmed: boolean | null; obv: string | null };
  invalidation: string[]; confidence: number; confidenceLabel: "High" | "Medium" | "Low" | "-";
  reviewBy: string | null; avgTurnover: number | null; fundamentalScore: number | null;
  netAtT1Pct: number | null;
  netRiskReward: number | null; // reward/risk after broker, SEBON, DP charges and CGT
}

export interface LongTermIdea { symbol: string; name: string; sector: string; price: number | null; priceDate: string | null; fundamentalScore: number; valuationScore: number | null; pe: number | null; pb: number | null; roe: number | null; cashYield: number | null; yearsPaid5: number | null; strengths: string[]; cautions: string[]; trend: string | null; entryNote: string; period: string | null }

const r2 = (x: number) => Math.round(x * 100) / 100;
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export interface OpportunityInput {
  symbol: string; name: string; sector: string; bars: Bar[];
  fundamentals: FundamentalInput | null;
  avgTurnover20: number | null;
  latestMarketDate: string; // the latest trading date in the database
  fees?: FeeConfig;
}

export const RULES = {
  minBars: 120, // about six months of trading
  maxStaleDays: 7, // last price older than this (calendar days) vs the market's latest date -> insufficient
  minTurnover: 1_000_000, // Rs. per day (20-day average); below this, avoid for liquidity
  buyMinQuality: 60, buyMinRR: 1.8, buyMinNetRR: 1.5, sellMinQuality: 55, minStopPct: 1.5,
};

/** Reward/risk after all costs for a 100-share trade: net profit at target 1 vs net loss at the stop. */
export function netRR(entry: number, stop: number, t1: number, days: number, fees: FeeConfig = DEFAULT_FEES) {
  try {
    const win = roundTrip(100, entry, t1, days, fees), loss = roundTrip(100, entry, stop, days, fees);
    const rr = loss.netProfit < 0 ? win.netProfit / -loss.netProfit : null;
    return { rr: rr != null ? r2(rr) : null, netT1Pct: r2(win.netReturnPct) };
  } catch { return { rr: null, netT1Pct: null }; }
}

/** Fills targets up to three: the setup's own targets, then the next resistances above, then marked R-multiples. */
function threeTargets(s: Setup, resistances: number[]): { price: number; basis: string }[] {
  const mid = (s.entryLow + s.entryHigh) / 2;
  const risk = mid - s.stopLoss;
  const out = s.targets.map((p, i) => ({ price: r2(p), basis: i === 0 ? "Setup target (nearest resistance / measured move)" : "Setup target" }));
  for (const r of resistances.filter((x) => x > (out[out.length - 1]?.price ?? mid) * 1.01).sort((a, b) => a - b)) {
    if (out.length >= 3) break;
    out.push({ price: r2(r), basis: "Next resistance level" });
  }
  let k = 2;
  while (out.length < 3 && risk > 0) { const p = r2(mid + risk * (k + 1)); if (!out.length || p > out[out.length - 1].price) out.push({ price: p, basis: `${k + 1}R projection (no resistance above to measure)` }); k++; }
  return out.slice(0, 3);
}

export function evaluate(inp: OpportunityInput): Opportunity {
  const { bars, fundamentals: fa } = inp;
  const last = bars[bars.length - 1];
  const base: Opportunity = {
    symbol: inp.symbol, name: inp.name, sector: inp.sector, price: last?.close ?? null, priceDate: last?.date ?? null,
    action: "INSUFFICIENT", bucket: "insufficient", headline: "", setupType: null, horizon: null, holdingPeriod: null,
    entryLow: null, entryHigh: null, entry: null, stop: null, targets: [], riskReward: null, riskPct: null, buyNow: null, waitFor: null,
    techReasons: [], fundReasons: [], supports: [], resistances: [],
    indicators: { rsi: null, macd: null, trend: null, adx: null, sma20: null, sma50: null, sma200: null, maPosition: null, volumeRatio: null, volumeConfirmed: null, obv: null },
    invalidation: [], confidence: 0, confidenceLabel: "-", reviewBy: null, avgTurnover: inp.avgTurnover20, fundamentalScore: fa?.score ?? null, netAtT1Pct: null, netRiskReward: null,
  };
  if (!last || bars.length < RULES.minBars) return { ...base, headline: `Insufficient data: ${bars.length} trading days of history (needs ${RULES.minBars}).` };
  const stale = (Date.parse(inp.latestMarketDate) - Date.parse(last.date)) / 86_400_000;
  if (stale > RULES.maxStaleDays) return { ...base, headline: `Insufficient data: last trade ${last.date}, ${Math.round(stale)} days before the latest market date. No signal on stale prices.` };

  const sig = generateSetups(bars, { symbol: inp.symbol, fees: inp.fees, fundamentalScore: fa?.score ?? null });
  const snap = sig.snapshot;
  if (!snap) return { ...base, headline: "Insufficient data to compute indicators." };
  const supports = (sig.levels?.supports ?? []).map((l) => r2(l.price)).slice(0, 4);
  const resistances = (sig.levels?.resistances ?? []).map((l) => r2(l.price)).slice(0, 4);
  const s20 = snap.sma[20] ?? null, s50 = snap.sma[50] ?? null, s200 = snap.sma[200] ?? null;
  const maPosition = s50 != null && s200 != null ? (snap.close > s50 && s50 > s200 ? "Above 50 > 200 (bullish stack)" : snap.close < s50 && s50 < s200 ? "Below 50 < 200 (bearish stack)" : "Mixed") : null;
  const indicators = {
    rsi: snap.rsi, macd: snap.macd.cross ? `${snap.macd.cross} cross` : snap.macd.histogram != null ? (snap.macd.histogram > 0 ? "above signal" : "below signal") : null,
    trend: snap.trend, adx: snap.adx, sma20: s20, sma50: s50, sma200: s200, maPosition, volumeRatio: snap.volumeRatio, volumeConfirmed: null as boolean | null, obv: snap.obvTrend,
  };
  const fundReasons: string[] = [];
  if (fa?.score != null) fundReasons.push(`Fundamental score ${fa.score}/100${fa.period ? ` (${fa.period})` : ""}.`);
  if (fa?.pe != null && fa.pe > 0) fundReasons.push(`P/E ${r2(fa.pe)}${fa.pb != null ? `, P/B ${r2(fa.pb)}` : ""}${fa.roe != null ? `, ROE ${r2(fa.roe)}%` : ""}.`);
  for (const x of (fa?.strengths ?? []).slice(0, 2)) fundReasons.push(x);
  for (const x of (fa?.redFlags ?? []).slice(0, 2)) fundReasons.push(`Caution: ${x}`);
  const common = { ...base, supports, resistances, indicators, fundReasons, price: snap.close, priceDate: snap.asOf, reviewBy: addDays(snap.asOf, 7) };

  // Liquidity first: thin stocks can't be entered or exited at the quoted price.
  if ((inp.avgTurnover20 ?? 0) < RULES.minTurnover) {
    return { ...common, action: "AVOID", bucket: "avoid", headline: `Avoid for now: illiquid (average turnover Rs. ${Math.round((inp.avgTurnover20 ?? 0) / 1000).toLocaleString("en-IN")}k a day).`, techReasons: ["Low trading value means wide price jumps and difficulty exiting."], invalidation: ["Daily turnover rising above Rs. 10 lakh on a sustained basis."], confidence: 70, confidenceLabel: "Medium" };
  }

  const buys = sig.setups.filter((s) => s.side === "buy").sort((a, b) => b.quality - a.quality);
  const sells = sig.setups.filter((s) => s.side === "sell").sort((a, b) => b.quality - a.quality);
  const sell = sells[0];
  if (sell && sell.quality >= RULES.sellMinQuality) {
    return {
      ...common, action: "SELL", bucket: "sell", setupType: sell.type, horizon: sell.horizon, holdingPeriod: "Exit or reduce now; no new buying",
      headline: `${sell.type}: protect gains or exit. NEPSE has no short selling, so this is for holders.`,
      techReasons: sell.reasoning, invalidation: sell.invalidation, stop: r2(sell.stopLoss),
      indicators: { ...indicators, volumeConfirmed: sell.volume.confirmed },
      confidence: Math.min(95, sell.quality), confidenceLabel: sell.quality >= 75 ? "High" : sell.quality >= 55 ? "Medium" : "Low",
    };
  }

  const b = buys[0];
  if (b) {
    const targets = threeTargets(b, resistances);
    const entry = r2((b.entryLow + b.entryHigh) / 2);
    const rr = b.riskReward;
    // A fall alone is never a buy: oversold bounces need a reversal (MACD cross up or close back above EMA 20) and volume.
    const reversal = snap.macd.cross === "bullish" || (snap.ema[20] != null && snap.close > (snap.ema[20] as number));
    const oversoldOk = b.type !== "Oversold bounce" || (reversal && b.volume.confirmed && b.quality >= 70);
    const inZone = snap.close <= b.entryHigh * 1.01 && snap.close >= b.entryLow * 0.98;
    let conf = b.quality + (b.volume.confirmed ? 5 : -5) + (snap.trend === "uptrend" ? 5 : snap.trend === "downtrend" ? -10 : 0) + (fa?.score != null ? (fa.score >= 60 ? 5 : fa.score < 40 ? -10 : 0) : -3) - Math.min(10, (fa?.redFlags.length ?? 0) * 5);
    conf = Math.max(5, Math.min(95, Math.round(conf)));
    // Levels must make sense: the stop below the whole buy range and far enough to survive normal noise.
    const levelsOk = b.stopLoss < b.entryLow * 0.997 && (entry - b.stopLoss) / entry >= RULES.minStopPct / 100 && rr <= 8;
    const qualifiesBeforeCosts = b.quality >= RULES.buyMinQuality && rr >= RULES.buyMinRR && oversoldOk && levelsOk;
    const nrr = netRR(entry, b.stopLoss, targets[0]?.price ?? entry, b.horizon.startsWith("swing") ? 20 : 90, inp.fees);
    const net = nrr.netT1Pct;
    const costsOk = nrr.rr != null && nrr.rr >= RULES.buyMinNetRR;
    const plan = {
      ...common, setupType: b.type, horizon: b.horizon, holdingPeriod: b.horizon.startsWith("swing") ? "1-4 weeks" : "1-6 months",
      entryLow: r2(b.entryLow), entryHigh: r2(b.entryHigh), entry, stop: r2(b.stopLoss), targets, riskReward: r2(rr), riskPct: r2(b.riskPct),
      techReasons: b.reasoning, invalidation: b.invalidation, indicators: { ...indicators, volumeConfirmed: b.volume.confirmed },
      confidence: conf, confidenceLabel: (conf >= 75 ? "High" : conf >= 55 ? "Medium" : "Low") as Opportunity["confidenceLabel"], netAtT1Pct: net, netRiskReward: nrr.rr,
    };
    const qualifies = qualifiesBeforeCosts && costsOk;
    if (qualifies && inZone) return { ...plan, action: "BUY", bucket: "buy", buyNow: b.volume.confirmed ? "now" : "wait", waitFor: b.volume.confirmed ? null : "a close inside the entry zone on above-average volume", headline: `${b.type}: price is in the entry zone (Rs. ${r2(b.entryLow)}-${r2(b.entryHigh)}), stop Rs. ${r2(b.stopLoss)}, R:R ${r2(rr)}.` };
    if (qualifies) return { ...plan, action: "WATCH", bucket: "watch", buyNow: "wait", waitFor: snap.close > b.entryHigh ? `a pullback into Rs. ${r2(b.entryLow)}-${r2(b.entryHigh)} (price is ${r2(((snap.close - b.entryHigh) / b.entryHigh) * 100)}% above the zone)` : `price to recover into the entry zone`, headline: `${b.type} setup, but price is outside the entry zone: wait for a better entry.` };
    const why = qualifiesBeforeCosts && !costsOk ? `after broker, SEBON, DP charges and tax the reward/risk is only ${nrr.rr != null ? r2(nrr.rr) : "-"} (needs ${RULES.buyMinNetRR}); the move is too small for the costs` : !levelsOk ? `the stop (Rs. ${r2(b.stopLoss)}) is too close to or inside the buy range, so risk can't be controlled` : !oversoldOk ? "it has fallen but has not yet shown a confirmed reversal" : rr < RULES.buyMinRR ? `reward/risk is only ${r2(rr)} (needs ${RULES.buyMinRR})` : `setup quality ${b.quality}/100 is below ${RULES.buyMinQuality}`;
    return { ...plan, action: "WATCH", bucket: "watch", buyNow: "wait", waitFor: !oversoldOk ? "a reversal: MACD bullish cross or a close above the 20-day EMA, on volume" : "a stronger setup (better reward/risk or confirmation)", headline: `${b.type} forming, not a buy yet: ${why}.` };
  }

  // No setup: holders' view from trend and fundamentals.
  const weakFund = fa?.score != null && fa.score < 40;
  if (snap.trend === "downtrend" && (weakFund || (fa?.redFlags.length ?? 0) >= 2 || maPosition?.startsWith("Below"))) {
    return { ...common, action: "AVOID", bucket: "avoid", headline: `Avoid for now: ${maPosition?.startsWith("Below") ? "price below falling 50- and 200-day averages" : "downtrend"}${weakFund ? " with weak fundamentals" : ""}.`, techReasons: snap.trendNotes, invalidation: [`A close back above the 50-day average${s50 ? ` (Rs. ${r2(s50)})` : ""} with rising volume.`], confidence: 60, confidenceLabel: "Medium" };
  }
  if (snap.trend === "uptrend" && maPosition?.startsWith("Above")) {
    const stop = supports.find((x) => x < snap.close) ?? (s50 != null ? r2(s50) : null);
    return { ...common, action: "HOLD", bucket: "hold", stop, headline: `Hold: uptrend intact (above rising 50- and 200-day averages), no fresh entry setup.`, techReasons: snap.trendNotes, invalidation: [stop ? `A daily close below Rs. ${stop}.` : "A close below the 50-day average."], confidence: 60, confidenceLabel: "Medium" };
  }
  return { ...common, action: "WATCH", bucket: "watch", buyNow: "wait", waitFor: "a clear setup (breakout, pullback to support or trend continuation)", headline: `No trade setup: trend is ${snap.trend}. Watch for a clear signal.`, techReasons: snap.trendNotes, confidence: 40, confidenceLabel: "Low" };
}

/** Long-term ideas are about the business, not the chart: strong fundamentals, sane valuation, no red flags. */
export function longTermIdea(o: Opportunity, fa: FundamentalInput | null): LongTermIdea | null {
  if (!fa || fa.score == null || fa.score < 65 || fa.redFlags.length > 0 || (o.avgTurnover ?? 0) < RULES.minTurnover) return null;
  if (fa.valuationScore != null && fa.valuationScore < 35) return null;
  const cautions: string[] = [];
  if (fa.pe != null && fa.pe > 35) cautions.push(`P/E ${r2(fa.pe)} is high`);
  if (o.indicators.trend === "downtrend") cautions.push("price is in a downtrend: consider buying in parts");
  return {
    symbol: o.symbol, name: o.name, sector: o.sector, price: o.price, priceDate: o.priceDate, fundamentalScore: fa.score, valuationScore: fa.valuationScore,
    pe: fa.pe, pb: fa.pb, roe: fa.roe, cashYield: fa.cashYield, yearsPaid5: fa.yearsPaid5, strengths: fa.strengths.slice(0, 3), cautions, trend: o.indicators.trend,
    entryNote: o.supports.length ? `Accumulate gradually; nearest support Rs. ${o.supports[0]}.` : "Accumulate gradually (monthly) rather than all at once.", period: fa.period,
  };
}

// ---------- signal track record (walk-forward, no look-ahead) ----------
export interface TrackTrade { symbol: string; date: string; type: string; entry: number; stop: number; t1: number; exitDate: string; exit: number; outcome: "target" | "stop" | "expired"; netPct: number; rMultiple: number }

/** Replays the BUY rule on past data: at each step only bars up to that day are used; the trade enters at the next open if inside the entry zone. */
export function trackRecord(symbol: string, bars: Bar[], fa: FundamentalInput | null, opts: { step?: number; lookback?: number; fees?: FeeConfig } = {}): TrackTrade[] {
  const step = opts.step ?? 5, lookback = opts.lookback ?? 250;
  const out: TrackTrade[] = [];
  let busyUntil = -1;
  for (let t = Math.max(RULES.minBars, bars.length - lookback); t < bars.length - 2; t += step) {
    if (t <= busyUntil) continue;
    const hist = bars.slice(0, t + 1);
    const sig = generateSetups(hist, { symbol, fees: opts.fees, fundamentalScore: fa?.score ?? null });
    const b = sig.setups.filter((s) => s.side === "buy").sort((x, y) => y.quality - x.quality)[0];
    const snap = sig.snapshot;
    if (!b || !snap || b.quality < RULES.buyMinQuality || b.riskReward < RULES.buyMinRR || b.riskReward > 8) continue;
    const mid0 = (b.entryLow + b.entryHigh) / 2;
    if (!(b.stopLoss < b.entryLow * 0.997 && (mid0 - b.stopLoss) / mid0 >= RULES.minStopPct / 100)) continue;
    const nr = netRR(mid0, b.stopLoss, b.targets[0], b.horizon.startsWith("swing") ? 20 : 90, opts.fees);
    if (nr.rr == null || nr.rr < RULES.buyMinNetRR) continue;
    const reversal = snap.macd.cross === "bullish" || (snap.ema[20] != null && snap.close > (snap.ema[20] as number));
    if (b.type === "Oversold bounce" && !(reversal && b.volume.confirmed && b.quality >= 70)) continue;
    const nx = bars[t + 1];
    if (nx.open > b.entryHigh * 1.01 || nx.open < b.stopLoss) continue; // gap away: no fill
    const entry = Math.max(nx.open, b.entryLow);
    const horizon = b.horizon.startsWith("swing") ? 20 : 60;
    let exit = bars[Math.min(bars.length - 1, t + 1 + horizon)].close, exitIdx = Math.min(bars.length - 1, t + 1 + horizon), outcome: TrackTrade["outcome"] = "expired";
    for (let k = t + 1; k <= Math.min(bars.length - 1, t + 1 + horizon); k++) {
      if (bars[k].low <= b.stopLoss) { exit = Math.min(bars[k].open, b.stopLoss); exitIdx = k; outcome = "stop"; break; }
      if (bars[k].high >= b.targets[0]) { exit = Math.max(bars[k].open, b.targets[0]); exitIdx = k; outcome = "target"; break; }
    }
    if (exitIdx >= bars.length - 1 && outcome === "expired" && t + 1 + horizon > bars.length - 1) continue; // still open: not judged yet
    const rt = roundTrip(100, entry, exit, Math.round((Date.parse(bars[exitIdx].date) - Date.parse(nx.date)) / 86_400_000), opts.fees ?? DEFAULT_FEES);
    out.push({ symbol, date: bars[t].date, type: b.type, entry: r2(entry), stop: r2(b.stopLoss), t1: r2(b.targets[0]), exitDate: bars[exitIdx].date, exit: r2(exit), outcome, netPct: r2(rt.netReturnPct), rMultiple: r2((exit - entry) / (entry - b.stopLoss)) });
    busyUntil = exitIdx;
  }
  return out;
}

export function summarizeTrack(trades: TrackTrade[]) {
  const n = trades.length;
  const wins = trades.filter((t) => t.netPct > 0).length;
  const byType = new Map<string, TrackTrade[]>();
  for (const t of trades) byType.set(t.type, [...(byType.get(t.type) ?? []), t]);
  const stat = (ts: TrackTrade[]) => ({ trades: ts.length, winRatePct: ts.length ? r2((ts.filter((t) => t.netPct > 0).length / ts.length) * 100) : null, targetHitPct: ts.length ? r2((ts.filter((t) => t.outcome === "target").length / ts.length) * 100) : null, stopHitPct: ts.length ? r2((ts.filter((t) => t.outcome === "stop").length / ts.length) * 100) : null, avgNetPct: ts.length ? r2(ts.reduce((s, t) => s + t.netPct, 0) / ts.length) : null, avgR: ts.length ? r2(ts.reduce((s, t) => s + t.rMultiple, 0) / ts.length) : null });
  return { ...stat(trades), wins, byType: [...byType.entries()].map(([type, ts]) => ({ type, ...stat(ts) })).sort((a, b) => b.trades - a.trades), n };
}
