// Support and resistance engine. Levels come from clustering historical swing
// points (price reactions), then scoring each cluster by how many times price
// reacted there, volume at those reactions, recency, and role reversal.
import type { Bar } from "./types.ts";
import { atr, sma, ema, last } from "./indicators.ts";

export interface Swing {
  index: number;
  date: string;
  price: number;
  kind: "high" | "low";
  volume: number;
}

export function findSwings(bars: Bar[], window = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = window; i < bars.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (bars[j].high > bars[i].high) isHigh = false;
      if (bars[j].low < bars[i].low) isLow = false;
    }
    // Ties: only accept the first bar of a flat top/bottom.
    if (isHigh && bars[i - 1].high !== bars[i].high) out.push({ index: i, date: bars[i].date, price: bars[i].high, kind: "high", volume: bars[i].volume });
    if (isLow && bars[i - 1].low !== bars[i].low) out.push({ index: i, date: bars[i].date, price: bars[i].low, kind: "low", volume: bars[i].volume });
  }
  return out;
}

export interface Level {
  price: number;
  low: number; // zone bounds (level +/- tolerance)
  high: number;
  type: "support" | "resistance";
  strength: "major" | "minor";
  score: number; // 0-100
  reactions: number; // swing highs/lows that formed here
  tests: number; // sessions whose range touched the level
  fromHighs: number;
  fromLows: number;
  roleReversal: boolean;
  volumeRatio: number | null; // avg volume at reactions / overall average
  volumeConfirmed: boolean;
  firstDate: string;
  lastDate: string;
  distancePct: number; // from latest close
  why: string;
  invalidation: string;
}

export interface DynamicLevel {
  name: string;
  price: number;
  type: "support" | "resistance";
  note: string;
}

export interface Zone {
  kind: "demand" | "supply";
  low: number;
  high: number;
  date: string;
  moveAtr: number; // size of the departure move in ATRs
  fresh: boolean; // not revisited since it formed
  why: string;
}

export interface LevelAnalysis {
  asOf: string;
  close: number;
  atr: number;
  tolerance: number;
  supports: Level[];
  resistances: Level[];
  dynamic: DynamicLevel[];
  zones: Zone[];
  breakoutLevel: number | null;
  breakdownLevel: number | null;
  method: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function analyzeLevels(allBars: Bar[], lookback = 500): LevelAnalysis | null {
  if (allBars.length < 30) return null;
  const bars = allBars.slice(-lookback);
  const close = bars[bars.length - 1].close;
  const atrS = atr(bars, 14);
  const a = (last(atrS) as number) || close * 0.02;
  const tol = Math.max(0.8 * a, close * 0.015);
  const avgVol = bars.reduce((s, b) => s + b.volume, 0) / bars.length || 1;

  const swings = findSwings(bars, 3);
  const sorted = [...swings].sort((x, y) => x.price - y.price);
  const clusters: Swing[][] = [];
  for (const s of sorted) {
    const c = clusters[clusters.length - 1];
    if (c) {
      const mean = c.reduce((t, x) => t + x.price, 0) / c.length;
      if (Math.abs(s.price - mean) <= tol) { c.push(s); continue; }
    }
    clusters.push([s]);
  }

  const n = bars.length;
  const levels: Level[] = [];
  for (const c of clusters) {
    // Recency-weighted mean price.
    let wsum = 0;
    let psum = 0;
    for (const s of c) {
      const w = 1 + s.index / n;
      wsum += w;
      psum += s.price * w;
    }
    const price = psum / wsum;
    const fromHighs = c.filter((s) => s.kind === "high").length;
    const fromLows = c.length - fromHighs;
    const reactions = c.length;
    const lastIdx = Math.max(...c.map((s) => s.index));
    const firstIdx = Math.min(...c.map((s) => s.index));
    let tests = 0;
    for (const b of bars) if (b.high >= price - tol && b.low <= price + tol) tests++;
    const vr = c.reduce((t, s) => t + s.volume, 0) / c.length / avgVol;
    const recency = 1 - (n - 1 - lastIdx) / n; // 1 = touched recently
    const roleReversal = fromHighs > 0 && fromLows > 0;
    let score = Math.min(reactions, 6) * 8 + recency * 22 + (vr > 1.3 ? 15 : vr > 1 ? 6 : 0) + (roleReversal ? 15 : 0);
    score = Math.max(0, Math.min(100, Math.round(score)));
    if (reactions < 2 && recency < 0.8) continue; // a single old swing is noise
    const type: Level["type"] = price < close ? "support" : "resistance";
    const strength: Level["strength"] = score >= 55 && reactions >= 3 ? "major" : "minor";
    const firstDate = bars[firstIdx].date;
    const lastDate = bars[lastIdx].date;
    const volText = vr > 1.3 ? `Volume at these reactions averaged ${vr.toFixed(1)}x normal, which confirms real buying/selling interest.` : `Volume at these reactions was ${vr.toFixed(1)}x normal, so volume does not strongly confirm it.`;
    const why =
      `${reactions} price reaction${reactions > 1 ? "s" : ""} (${fromLows} swing low${fromLows === 1 ? "" : "s"}, ${fromHighs} swing high${fromHighs === 1 ? "" : "s"}) between ${firstDate} and ${lastDate}; price traded through this zone on ${tests} sessions. ` +
      (roleReversal ? "It has acted as both support and resistance (role reversal), which usually makes a level more important. " : "") +
      volText;
    const invalidation =
      type === "support"
        ? `A daily close below Rs. ${round2(price - tol)} (level minus tolerance) would break this support.`
        : `A daily close above Rs. ${round2(price + tol)} on above-average volume would break this resistance.`;
    levels.push({
      price: round2(price), low: round2(price - tol), high: round2(price + tol), type, strength, score, reactions, tests,
      fromHighs, fromLows, roleReversal, volumeRatio: round2(vr), volumeConfirmed: vr > 1.3, firstDate, lastDate,
      distancePct: round2(((price - close) / close) * 100), why, invalidation,
    });
  }

  // Keep the strongest levels, at least 2 x tolerance apart, then order by distance from price.
  const pick = (list: Level[]) => {
    const kept: Level[] = [];
    for (const l of [...list].sort((x, y) => y.score - x.score)) {
      if (kept.every((k) => Math.abs(k.price - l.price) >= 2 * tol)) kept.push(l);
      if (kept.length >= 5) break;
    }
    return kept;
  };
  const supports = pick(levels.filter((l) => l.type === "support")).sort((x, y) => y.price - x.price);
  const resistances = pick(levels.filter((l) => l.type === "resistance")).sort((x, y) => x.price - y.price);

  const closes = bars.map((b) => b.close);
  const dynamic: DynamicLevel[] = [];
  const addDyn = (name: string, v: number | null, note: string) => {
    if (v == null) return;
    dynamic.push({ name, price: round2(v), type: v < close ? "support" : "resistance", note });
  };
  addDyn("EMA 20", last(ema(closes, 20)), "Short-term trend line; pullbacks in strong trends often hold here.");
  addDyn("SMA 50", last(sma(closes, 50)), "Medium-term trend; widely watched by swing traders.");
  addDyn("SMA 200", last(sma(closes, 200)), "Long-term trend; price above it is generally considered a long-term uptrend.");

  const zones = findZones(bars, atrS, a);
  const majorRes = resistances.find((l) => l.strength === "major") || resistances[0];
  const majorSup = supports.find((l) => l.strength === "major") || supports[0];

  return {
    asOf: bars[n - 1].date,
    close,
    atr: round2(a),
    tolerance: round2(tol),
    supports,
    resistances,
    dynamic,
    zones,
    breakoutLevel: majorRes ? majorRes.high : null,
    breakdownLevel: majorSup ? majorSup.low : null,
    method:
      "Swing highs/lows (3 sessions either side) over the last " + bars.length + " sessions are clustered within a tolerance of max(0.8 x ATR14, 1.5% of price); the strongest levels at least 2 x tolerance apart are kept. " +
      "Score = reactions (8 each, max 6) + recency (up to 22) + volume confirmation (up to 15) + role reversal (15). Major = score >= 55 with at least 3 reactions.",
  };
}

/** Demand/supply zones: a tight base (1-3 sessions) followed by a strong departure move. */
function findZones(bars: Bar[], atrS: (number | null)[], fallbackAtr: number): Zone[] {
  const zones: Zone[] = [];
  for (let i = 3; i < bars.length - 3; i++) {
    const a = atrS[i] ?? fallbackAtr;
    const base = bars.slice(i - 2, i + 1);
    const baseRange = Math.max(...base.map((b) => b.high)) - Math.min(...base.map((b) => b.low));
    if (baseRange > 1.5 * a) continue;
    const after = bars[i + 3].close - bars[i].close;
    const moveAtr = Math.abs(after) / a;
    if (moveAtr < 2.5) continue;
    const kind: Zone["kind"] = after > 0 ? "demand" : "supply";
    const low = Math.min(...base.map((b) => b.low));
    const high = Math.max(...base.map((b) => b.high));
    // Fresh = price has not come back into the zone since.
    let fresh = true;
    let violated = false;
    for (let j = i + 4; j < bars.length; j++) {
      if (bars[j].low <= high && bars[j].high >= low) fresh = false;
      if (kind === "demand" && bars[j].close < low) violated = true;
      if (kind === "supply" && bars[j].close > high) violated = true;
    }
    if (violated) continue;
    zones.push({
      kind, low: round2(low), high: round2(high), date: bars[i].date, moveAtr: round2(moveAtr), fresh,
      why: `${base.length}-session base around ${bars[i].date}, then a ${moveAtr.toFixed(1)} ATR ${kind === "demand" ? "rally" : "drop"} within 3 sessions. ` +
        (fresh ? "Price has not returned to it yet (fresh)." : "Price has revisited it and it held (no close through)."),
    });
  }
  // Merge overlapping zones of the same kind; keep the most recent few.
  zones.sort((x, y) => (x.date < y.date ? 1 : -1));
  const kept: Zone[] = [];
  for (const z of zones) {
    if (kept.some((k) => k.kind === z.kind && k.low <= z.high && z.low <= k.high)) continue;
    kept.push(z);
    if (kept.length >= 6) break;
  }
  return kept;
}
