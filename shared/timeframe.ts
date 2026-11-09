// Timeframes and trendlines for the chart.
// resample(): daily bars to weekly (Sunday-Thursday or Monday-Friday NEPSE weeks) or monthly bars.
// trendlines(): support/resistance lines through the two most significant recent swing points,
// with how many times price touched them and whether the latest close broke through (with volume).
import type { Bar } from "./types.ts";
import { findSwings } from "./levels.ts";

export type Timeframe = "D" | "W" | "M";

/** ISO week key (Monday-based) so a NEPSE trading week stays in one bucket. */
function weekKey(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  const day = (t.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  // NEPSE once traded Sunday-Thursday: treat Sunday as the start of the following week.
  const shift = t.getUTCDay() === 0 ? 1 : -day;
  const monday = new Date(t.getTime() + shift * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export function resample(bars: Bar[], tf: Timeframe): Bar[] {
  if (tf === "D") return bars;
  const out: Bar[] = [];
  let key = "";
  for (const b of bars) {
    const k = tf === "W" ? weekKey(b.date) : b.date.slice(0, 7);
    const cur = out[out.length - 1];
    if (k !== key || !cur) {
      out.push({ ...b });
      key = k;
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
      cur.amount = cur.amount != null && b.amount != null ? cur.amount + b.amount : undefined;
      cur.date = b.date; // a bar is labelled by its last trading day
    }
  }
  return out;
}

export interface Trendline {
  kind: "support" | "resistance";
  from: { date: string; price: number; index: number };
  to: { date: string; price: number; index: number };
  slopePctPerBar: number; // % of price per bar
  touches: number;
  valueNow: number; // where the line is on the latest bar
  broken: boolean; // latest close beyond the line by more than 1%
  volumeConfirmed: boolean; // breakout bar volume >= 1.5x the 20-bar average
  why: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function lineThrough(a: { index: number; price: number }, b: { index: number; price: number }) {
  const slope = (b.price - a.price) / (b.index - a.index);
  return (i: number) => a.price + slope * (i - a.index);
}

/** Up to one support and one resistance trendline from recent swings (last ~150 bars). */
export function trendlines(bars: Bar[], lookback = 150): Trendline[] {
  if (bars.length < 30) return [];
  const start = Math.max(0, bars.length - lookback);
  const recent = bars.slice(start);
  const swings = findSwings(recent, 3).map((s) => ({ ...s, index: s.index + start }));
  const lastI = bars.length - 1, last = bars[lastI];
  const avgVol = bars.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / Math.max(1, Math.min(20, bars.length - 1));
  const out: Trendline[] = [];
  for (const kind of ["support", "resistance"] as const) {
    const pts = swings.filter((s) => s.kind === (kind === "support" ? "low" : "high"));
    if (pts.length < 2) continue;
    let best: Trendline | null = null;
    // Try pairs among the last 6 swing points; keep the line that price respected most and that no bar violated in between.
    const cand = pts.slice(-6);
    for (let i = 0; i < cand.length - 1; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i], b = cand[j];
        if (b.index - a.index < 5) continue;
        const f = lineThrough(a, b);
        let violated = false, touches = 0;
        for (let k = a.index; k <= Math.min(lastI - 1, lastI); k++) {
          const v = f(k), bar = bars[k];
          const tol = v * 0.012;
          if (kind === "support") { if (k <= b.index && bar.close < v - tol) violated = true; if (Math.abs(bar.low - v) <= tol) touches++; }
          else { if (k <= b.index && bar.close > v + tol) violated = true; if (Math.abs(bar.high - v) <= tol) touches++; }
        }
        if (violated) continue;
        const valueNow = f(lastI);
        if (valueNow <= 0) continue;
        const broken = kind === "support" ? last.close < valueNow * 0.99 : last.close > valueNow * 1.01;
        const slopePct = ((f(lastI) - f(lastI - 1)) / valueNow) * 100;
        const tl: Trendline = {
          kind, from: { date: a.date, price: r2(a.price), index: a.index }, to: { date: bars[lastI].date, price: r2(valueNow), index: lastI },
          slopePctPerBar: Math.round(slopePct * 1000) / 1000, touches, valueNow: r2(valueNow), broken,
          volumeConfirmed: broken && last.volume >= avgVol * 1.5,
          why: "",
        };
        if (!best || tl.touches > best.touches || (tl.touches === best.touches && b.index > best.from.index)) best = tl;
      }
    }
    if (best) {
      const dir = best.slopePctPerBar > 0.02 ? "rising" : best.slopePctPerBar < -0.02 ? "falling" : "flat";
      best.why = best.broken
        ? `${kind === "support" ? "Close below" : "Close above"} a ${dir} ${kind} trendline (${best.touches} touches) at ${best.valueNow}${best.volumeConfirmed ? ", on volume 1.5x+ the 20-day average (confirmed)" : ", without a volume surge yet (unconfirmed)"}.`
        : `${dir[0].toUpperCase() + dir.slice(1)} ${kind} trendline from ${best.from.date}, ${best.touches} touches, now at ${best.valueNow}.`;
      out.push(best);
    }
  }
  return out;
}
