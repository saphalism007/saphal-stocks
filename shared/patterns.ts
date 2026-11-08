// Algorithmic chart-pattern detection on swing points. Nothing here is
// guessed by a language model: each rule is geometric and testable, and
// `patternTrackRecord` replays the same rules over the stock's own history.
import type { Bar } from "./types.ts";
import { findSwings, type Swing } from "./levels.ts";
import { atr, sma, last } from "./indicators.ts";

export type PatternName =
  | "Double top" | "Double bottom" | "Head and shoulders" | "Inverse head and shoulders"
  | "Ascending triangle" | "Descending triangle" | "Symmetrical triangle"
  | "Rising wedge" | "Falling wedge" | "Ascending channel" | "Descending channel" | "Horizontal channel"
  | "Bull flag" | "Bear flag" | "Cup and handle" | "Breakout" | "Breakdown";

export interface Pattern {
  name: PatternName;
  direction: "bullish" | "bearish" | "neutral";
  status: "forming" | "confirmed";
  startDate: string;
  endDate: string;
  keyLevel: number | null; // neckline / breakout line
  target: number | null; // measured-move target
  invalidation: number | null;
  confidence: number; // 0-100, geometric quality only
  points: { date: string; price: number }[];
  description: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => Math.abs(a - b) / ((a + b) / 2);

function linreg(pts: { x: number; y: number }[]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  let ssr = 0;
  let sst = 0;
  for (const p of pts) { ssr += (p.y - (slope * p.x + intercept)) ** 2; sst += (p.y - my) ** 2; }
  return { slope, intercept, r2: sst ? 1 - ssr / sst : 1 };
}

export function detectPatterns(allBars: Bar[]): Pattern[] {
  if (allBars.length < 60) return [];
  const bars = allBars.slice(-260);
  const n = bars.length;
  const close = bars[n - 1].close;
  const a = (last(atr(bars, 14)) as number) || close * 0.02;
  const swings = findSwings(bars, 5);
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  const out: Pattern[] = [];
  const pt = (s: Swing) => ({ date: s.date, price: s.price });
  const closedBelow = (from: number, level: number) => bars.slice(from).some((b) => b.close < level);
  const closedAbove = (from: number, level: number) => bars.slice(from).some((b) => b.close > level);

  // Double top / bottom: last two swing highs (lows) roughly equal, separated, with a meaningful trough (peak).
  if (highs.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    const mid = lows.filter((l) => l.index > h1.index && l.index < h2.index);
    if (mid.length && h2.index - h1.index >= 10 && pct(h1.price, h2.price) < 0.03 && n - h2.index < 60) {
      const neck = Math.min(...mid.map((m) => m.price));
      const depth = Math.max(h1.price, h2.price) - neck;
      if (depth > 2 * a && depth / neck > 0.05) {
        const confirmed = closedBelow(h2.index, neck);
        out.push({
          name: "Double top", direction: "bearish", status: confirmed ? "confirmed" : "forming",
          startDate: h1.date, endDate: bars[n - 1].date, keyLevel: r2(neck), target: r2(neck - depth),
          invalidation: r2(Math.max(h1.price, h2.price)), confidence: Math.round(80 - pct(h1.price, h2.price) * 600),
          points: [pt(h1), { date: mid[0].date, price: neck }, pt(h2)],
          description: `Two peaks near Rs. ${r2(h1.price)} and Rs. ${r2(h2.price)} with a trough at Rs. ${r2(neck)}. ` +
            (confirmed ? "Price has closed below the neckline, confirming the pattern." : "Not confirmed until a close below the neckline."),
        });
      }
    }
  }
  if (lows.length >= 2) {
    const [l1, l2] = lows.slice(-2);
    const mid = highs.filter((h) => h.index > l1.index && h.index < l2.index);
    if (mid.length && l2.index - l1.index >= 10 && pct(l1.price, l2.price) < 0.03 && n - l2.index < 60) {
      const neck = Math.max(...mid.map((m) => m.price));
      const depth = neck - Math.min(l1.price, l2.price);
      if (depth > 2 * a && depth / neck > 0.05) {
        const confirmed = closedAbove(l2.index, neck);
        out.push({
          name: "Double bottom", direction: "bullish", status: confirmed ? "confirmed" : "forming",
          startDate: l1.date, endDate: bars[n - 1].date, keyLevel: r2(neck), target: r2(neck + depth),
          invalidation: r2(Math.min(l1.price, l2.price)), confidence: Math.round(80 - pct(l1.price, l2.price) * 600),
          points: [pt(l1), { date: mid[0].date, price: neck }, pt(l2)],
          description: `Two troughs near Rs. ${r2(l1.price)} and Rs. ${r2(l2.price)} with a peak at Rs. ${r2(neck)}. ` +
            (confirmed ? "Price has closed above the neckline, confirming the pattern." : "Not confirmed until a close above the neckline."),
        });
      }
    }
  }

  // Head and shoulders (and inverse): three consecutive swing highs (lows), middle one extreme.
  if (highs.length >= 3) {
    const [ls, hd, rs] = highs.slice(-3);
    if (hd.price > ls.price * 1.03 && hd.price > rs.price * 1.03 && pct(ls.price, rs.price) < 0.05 && n - rs.index < 50) {
      const t1 = lows.filter((l) => l.index > ls.index && l.index < hd.index);
      const t2 = lows.filter((l) => l.index > hd.index && l.index < rs.index);
      if (t1.length && t2.length) {
        const neck = (Math.min(...t1.map((t) => t.price)) + Math.min(...t2.map((t) => t.price))) / 2;
        const confirmed = closedBelow(rs.index, neck);
        out.push({
          name: "Head and shoulders", direction: "bearish", status: confirmed ? "confirmed" : "forming",
          startDate: ls.date, endDate: bars[n - 1].date, keyLevel: r2(neck), target: r2(neck - (hd.price - neck)),
          invalidation: r2(rs.price), confidence: Math.round(75 - pct(ls.price, rs.price) * 400),
          points: [pt(ls), pt(hd), pt(rs)],
          description: `Left shoulder Rs. ${r2(ls.price)}, head Rs. ${r2(hd.price)}, right shoulder Rs. ${r2(rs.price)}, neckline about Rs. ${r2(neck)}.`,
        });
      }
    }
  }
  if (lows.length >= 3) {
    const [ls, hd, rs] = lows.slice(-3);
    if (hd.price < ls.price * 0.97 && hd.price < rs.price * 0.97 && pct(ls.price, rs.price) < 0.05 && n - rs.index < 50) {
      const p1 = highs.filter((h) => h.index > ls.index && h.index < hd.index);
      const p2 = highs.filter((h) => h.index > hd.index && h.index < rs.index);
      if (p1.length && p2.length) {
        const neck = (Math.max(...p1.map((t) => t.price)) + Math.max(...p2.map((t) => t.price))) / 2;
        const confirmed = closedAbove(rs.index, neck);
        out.push({
          name: "Inverse head and shoulders", direction: "bullish", status: confirmed ? "confirmed" : "forming",
          startDate: ls.date, endDate: bars[n - 1].date, keyLevel: r2(neck), target: r2(neck + (neck - hd.price)),
          invalidation: r2(rs.price), confidence: Math.round(75 - pct(ls.price, rs.price) * 400),
          points: [pt(ls), pt(hd), pt(rs)],
          description: `Left shoulder Rs. ${r2(ls.price)}, head Rs. ${r2(hd.price)}, right shoulder Rs. ${r2(rs.price)}, neckline about Rs. ${r2(neck)}.`,
        });
      }
    }
  }

  // Triangles, wedges and channels from trendlines through the recent swings (last ~90 sessions).
  const rh = highs.filter((h) => h.index >= n - 90);
  const rl = lows.filter((l) => l.index >= n - 90);
  if (rh.length >= 3 && rl.length >= 3) {
    const hr = linreg(rh.map((s) => ({ x: s.index, y: s.price })));
    const lr = linreg(rl.map((s) => ({ x: s.index, y: s.price })));
    const hs = hr.slope / close; // fractional slope per session
    const ls = lr.slope / close;
    const flat = 0.0006;
    const fit = Math.min(hr.r2, lr.r2);
    const upperNow = hr.slope * (n - 1) + hr.intercept;
    const lowerNow = lr.slope * (n - 1) + lr.intercept;
    const width0 = (hr.slope * rh[0].index + hr.intercept) - (lr.slope * rl[0].index + lr.intercept);
    const widthNow = upperNow - lowerNow;
    const converging = widthNow < width0 * 0.75 && widthNow > 0;
    const start = Math.min(rh[0].index, rl[0].index);
    const base = {
      startDate: bars[start].date, endDate: bars[n - 1].date,
      points: [...rh, ...rl].sort((x, y) => x.index - y.index).map(pt),
    };
    const height = width0;
    const brokeUp = close > upperNow;
    const brokeDown = close < lowerNow;
    const status = (dir: "up" | "down" | "any"): Pattern["status"] =>
      (dir === "up" && brokeUp) || (dir === "down" && brokeDown) || (dir === "any" && (brokeUp || brokeDown)) ? "confirmed" : "forming";
    const conf = (x: number) => Math.max(20, Math.min(90, Math.round(x)));
    let p: Pattern | null = null;
    if (Math.abs(hs) < flat && ls > flat && converging) {
      p = { ...base, name: "Ascending triangle", direction: "bullish", status: status("up"), keyLevel: r2(upperNow), target: r2(upperNow + height), invalidation: r2(lowerNow), confidence: conf(fit * 90), description: `Flat resistance near Rs. ${r2(upperNow)} with rising lows. Bullish if price closes above resistance.` };
    } else if (Math.abs(ls) < flat && hs < -flat && converging) {
      p = { ...base, name: "Descending triangle", direction: "bearish", status: status("down"), keyLevel: r2(lowerNow), target: r2(lowerNow - height), invalidation: r2(upperNow), confidence: conf(fit * 90), description: `Flat support near Rs. ${r2(lowerNow)} with falling highs. Bearish if price closes below support.` };
    } else if (hs < -flat && ls > flat && converging) {
      p = { ...base, name: "Symmetrical triangle", direction: "neutral", status: status("any"), keyLevel: r2(brokeDown ? lowerNow : upperNow), target: brokeDown ? r2(lowerNow - height) : r2(upperNow + height), invalidation: r2(brokeDown ? upperNow : lowerNow), confidence: conf(fit * 85), description: `Converging trendlines (falling highs, rising lows) between Rs. ${r2(lowerNow)} and Rs. ${r2(upperNow)}. Direction is decided by the breakout.` };
    } else if (hs > flat && ls > flat && converging && ls > hs) {
      p = { ...base, name: "Rising wedge", direction: "bearish", status: status("down"), keyLevel: r2(lowerNow), target: r2(bars[start].low), invalidation: r2(upperNow), confidence: conf(fit * 80), description: `Both trendlines rising but converging; momentum is fading. Often resolves downward through Rs. ${r2(lowerNow)}.` };
    } else if (hs < -flat && ls < -flat && converging && hs < ls) {
      p = { ...base, name: "Falling wedge", direction: "bullish", status: status("up"), keyLevel: r2(upperNow), target: r2(bars[start].high), invalidation: r2(lowerNow), confidence: conf(fit * 80), description: `Both trendlines falling but converging; selling pressure is fading. Often resolves upward through Rs. ${r2(upperNow)}.` };
    } else if (!converging && Math.abs(hs - ls) < flat * 1.5 && fit > 0.6) {
      const dir = hs > flat ? "Ascending channel" : hs < -flat ? "Descending channel" : "Horizontal channel";
      p = { ...base, name: dir, direction: dir === "Ascending channel" ? "bullish" : dir === "Descending channel" ? "bearish" : "neutral", status: "forming", keyLevel: r2(upperNow), target: null, invalidation: r2(lowerNow), confidence: conf(fit * 85), description: `Price is moving between two roughly parallel lines: support near Rs. ${r2(lowerNow)}, resistance near Rs. ${r2(upperNow)}.` };
    }
    if (p) out.push(p);
  }

  // Flags: a sharp pole (>= 10% in <= 10 sessions) then a tight, shallow counter-drift of 5-20 sessions.
  for (const dir of ["bull", "bear"] as const) {
    for (let cons = 5; cons <= 20; cons++) {
      const poleEnd = n - 1 - cons;
      const poleStart = poleEnd - 10;
      if (poleStart < 0) break;
      const p0 = bars[poleStart].close;
      const p1 = bars[poleEnd].close;
      const move = (p1 - p0) / p0;
      if (dir === "bull" ? move < 0.1 : move > -0.1) continue;
      const seg = bars.slice(poleEnd + 1);
      const hi = Math.max(...seg.map((b) => b.high));
      const lo = Math.min(...seg.map((b) => b.low));
      const pole = Math.abs(p1 - p0);
      const retrace = dir === "bull" ? (p1 - lo) / pole : (hi - p1) / pole;
      if (retrace > 0.5 || hi - lo > pole * 0.6) continue;
      const broke = dir === "bull" ? close > hi * 0.999 && bars[n - 1].close > bars[n - 2].high : close < lo * 1.001 && bars[n - 1].close < bars[n - 2].low;
      out.push({
        name: dir === "bull" ? "Bull flag" : "Bear flag", direction: dir === "bull" ? "bullish" : "bearish",
        status: broke ? "confirmed" : "forming", startDate: bars[poleStart].date, endDate: bars[n - 1].date,
        keyLevel: r2(dir === "bull" ? hi : lo), target: r2(dir === "bull" ? hi + pole : lo - pole), invalidation: r2(dir === "bull" ? lo : hi),
        confidence: Math.round(70 - retrace * 60),
        points: [{ date: bars[poleStart].date, price: p0 }, { date: bars[poleEnd].date, price: p1 }, { date: bars[n - 1].date, price: close }],
        description: `${(move * 100).toFixed(1)}% pole in 10 sessions, then ${cons} sessions of consolidation retracing ${(retrace * 100).toFixed(0)}% of the pole.`,
      });
      break;
    }
  }

  // Cup and handle: rounded base 12-35% deep over 40-200 sessions, right rim near left rim, small handle.
  {
    const window = bars.slice(-200);
    const off = n - window.length;
    let leftIdx = 0;
    for (let i = 0; i < window.length * 0.4; i++) if (window[i].high > window[leftIdx].high) leftIdx = i;
    const leftRim = window[leftIdx].high;
    let botIdx = leftIdx;
    for (let i = leftIdx; i < window.length; i++) if (window[i].low < window[botIdx].low) botIdx = i;
    const depth = (leftRim - window[botIdx].low) / leftRim;
    let rightIdx = botIdx;
    for (let i = botIdx; i < window.length; i++) if (window[i].high > window[rightIdx].high) rightIdx = i;
    const rightRim = window[rightIdx].high;
    const handleLen = window.length - 1 - rightIdx;
    const handleLow = Math.min(...window.slice(rightIdx).map((b) => b.low));
    const handleDepth = (rightRim - handleLow) / (rightRim - window[botIdx].low || 1);
    const cupLen = rightIdx - leftIdx;
    if (depth > 0.12 && depth < 0.35 && cupLen >= 40 && pct(leftRim, rightRim) < 0.05 && handleLen >= 3 && handleLen <= 25 && handleDepth < 0.5 && botIdx - leftIdx > cupLen * 0.25 && rightIdx - botIdx > cupLen * 0.25) {
      const confirmed = close > Math.max(leftRim, rightRim);
      out.push({
        name: "Cup and handle", direction: "bullish", status: confirmed ? "confirmed" : "forming",
        startDate: window[leftIdx].date, endDate: bars[n - 1].date, keyLevel: r2(Math.max(leftRim, rightRim)),
        target: r2(Math.max(leftRim, rightRim) + (leftRim - window[botIdx].low)), invalidation: r2(handleLow),
        confidence: Math.round(70 - pct(leftRim, rightRim) * 400),
        points: [{ date: window[leftIdx].date, price: leftRim }, { date: window[botIdx].date, price: window[botIdx].low }, { date: window[rightIdx].date, price: rightRim }],
        description: `Cup ${(depth * 100).toFixed(0)}% deep over ${cupLen} sessions (rims Rs. ${r2(leftRim)} / Rs. ${r2(rightRim)}), handle of ${handleLen} sessions.`,
      });
      void off;
    }
  }

  // Breakout / breakdown on the latest session: close beyond the prior 20-session range on 1.5x volume.
  {
    const vols = bars.map((b) => b.volume);
    const v20 = sma(vols, 20);
    const prior = bars.slice(n - 21, n - 1);
    const hh = Math.max(...prior.map((b) => b.high));
    const ll = Math.min(...prior.map((b) => b.low));
    const vRatio = v20[n - 2] ? bars[n - 1].volume / (v20[n - 2] as number) : 0;
    if (close > hh) {
      out.push({
        name: "Breakout", direction: "bullish", status: vRatio >= 1.5 ? "confirmed" : "forming", startDate: prior[0].date, endDate: bars[n - 1].date,
        keyLevel: r2(hh), target: r2(close + (hh - ll)), invalidation: r2(hh - a), confidence: Math.round(Math.min(90, 40 + vRatio * 20)),
        points: [{ date: bars[n - 1].date, price: close }],
        description: `Closed at Rs. ${r2(close)}, above the 20-session high of Rs. ${r2(hh)}, on ${vRatio.toFixed(1)}x average volume${vRatio >= 1.5 ? " (volume-confirmed)" : " (volume not yet confirming)"}.`,
      });
    } else if (close < ll) {
      out.push({
        name: "Breakdown", direction: "bearish", status: vRatio >= 1.5 ? "confirmed" : "forming", startDate: prior[0].date, endDate: bars[n - 1].date,
        keyLevel: r2(ll), target: r2(close - (hh - ll)), invalidation: r2(ll + a), confidence: Math.round(Math.min(90, 40 + vRatio * 20)),
        points: [{ date: bars[n - 1].date, price: close }],
        description: `Closed at Rs. ${r2(close)}, below the 20-session low of Rs. ${r2(ll)}, on ${vRatio.toFixed(1)}x average volume.`,
      });
    }
  }

  return out.map((p) => ({ ...p, confidence: Math.max(10, Math.min(95, p.confidence)) }));
}

export interface TrackRecord {
  name: PatternName;
  occurrences: number;
  targetHit: number;
  invalidated: number;
  hitRate: number | null;
  avgForwardReturn60: number | null; // % move 60 sessions after confirmation (direction-adjusted)
}

/**
 * Replays detection over the stock's own history (every 5 sessions) and checks what
 * happened after each newly confirmed pattern: did price reach the target before
 * the invalidation level, within 60 sessions?
 */
export function patternTrackRecord(bars: Bar[], step = 5): TrackRecord[] {
  const stats = new Map<PatternName, { occ: number; hit: number; inv: number; fwd: number[] }>();
  const seen = new Set<string>();
  for (let end = 120; end < bars.length - 1; end += step) {
    const slice = bars.slice(0, end);
    for (const p of detectPatterns(slice)) {
      if (p.status !== "confirmed" || p.target == null || p.invalidation == null) continue;
      const key = `${p.name}|${p.startDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = stats.get(p.name) || { occ: 0, hit: 0, inv: 0, fwd: [] };
      s.occ++;
      const bull = p.direction !== "bearish" ? p.target > slice[slice.length - 1].close : false;
      const entry = slice[slice.length - 1].close;
      let outcome: "hit" | "inv" | null = null;
      for (let j = end; j < Math.min(bars.length, end + 60); j++) {
        const b = bars[j];
        if (bull) {
          if (b.low <= p.invalidation) { outcome = "inv"; break; }
          if (b.high >= p.target) { outcome = "hit"; break; }
        } else {
          if (b.high >= p.invalidation) { outcome = "inv"; break; }
          if (b.low <= p.target) { outcome = "hit"; break; }
        }
      }
      if (outcome === "hit") s.hit++;
      if (outcome === "inv") s.inv++;
      const fwdIdx = Math.min(bars.length - 1, end + 60);
      const ret = ((bars[fwdIdx].close - entry) / entry) * 100;
      s.fwd.push(bull ? ret : -ret);
      stats.set(p.name, s);
    }
  }
  return [...stats.entries()].map(([name, s]) => ({
    name, occurrences: s.occ, targetHit: s.hit, invalidated: s.inv,
    hitRate: s.occ ? Math.round((s.hit / s.occ) * 1000) / 10 : null,
    avgForwardReturn60: s.fwd.length ? Math.round((s.fwd.reduce((x, y) => x + y, 0) / s.fwd.length) * 10) / 10 : null,
  }));
}
