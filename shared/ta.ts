// Indicator library for the chart terminal: 55+ indicators, each a pure function of real daily
// bars with configurable parameters. Every output series is aligned to the input bars and is null
// until there is enough history. Formulas follow the standard published definitions (Wilder,
// Appel, Lane, Chaikin, Ehlers, ...). Tested in tests/ta.test.ts.
import type { Bar, Series } from "./types.ts";
import { sma as smaN, ema as emaN, rsi as rsiN, macd as macdN, bollinger as bbN, atr as atrN, stochastic as stochN, adx as adxN, obv as obvN, ichimoku as ichN, supertrend as stN, parabolicSar as psarN, trueRange } from "./indicators.ts";

export type Group = "Moving averages" | "Trend" | "Momentum" | "Volatility" | "Volume";
export interface ParamDef { key: string; label: string; def: number; min?: number; max?: number; step?: number }
export interface OutputDef { key: string; label: string; color: string; kind?: "line" | "histogram" | "dots" | "step"; connect?: boolean; width?: number; dashed?: boolean }
export interface IndicatorDef {
  id: string; name: string; short: string; group: Group; overlay: boolean; desc: string;
  params: ParamDef[]; outputs: OutputDef[]; levels?: number[];
  compute: (bars: Bar[], p: Record<string, number>) => Record<string, Series>;
}

const N = (n: number): Series => new Array(n).fill(null);
const nn = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

// ---------- series helpers (null-aware) ----------
/** Rolling window over a series that may start with nulls; null if any value in the window is null. */
function rolling(s: Series, p: number, f: (w: number[]) => number): Series {
  const out = N(s.length);
  for (let i = p - 1; i < s.length; i++) {
    const w: number[] = [];
    let ok = true;
    for (let j = i - p + 1; j <= i; j++) { const v = s[j]; if (!nn(v)) { ok = false; break; } w.push(v); }
    if (ok) out[i] = f(w);
  }
  return out;
}
export const smaS = (s: Series, p: number) => rolling(s, p, (w) => w.reduce((a, b) => a + b, 0) / p);
export const sumS = (s: Series, p: number) => rolling(s, p, (w) => w.reduce((a, b) => a + b, 0));
export const wmaS = (s: Series, p: number) => rolling(s, p, (w) => { let t = 0; for (let i = 0; i < p; i++) t += w[i] * (i + 1); return t / ((p * (p + 1)) / 2); });
export const highestS = (s: Series, p: number) => rolling(s, p, (w) => Math.max(...w));
export const lowestS = (s: Series, p: number) => rolling(s, p, (w) => Math.min(...w));
export const stdevS = (s: Series, p: number) => rolling(s, p, (w) => { const m = w.reduce((a, b) => a + b, 0) / p; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / p); });
/** Exponential average seeded with the SMA of the first full window; alpha defaults to 2/(p+1). */
export function emaS(s: Series, p: number, alpha = 2 / (p + 1)): Series {
  const out = N(s.length);
  let run = 0, prev: number | null = null, seedSum = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!nn(v)) { if (prev == null) { run = 0; seedSum = 0; } continue; }
    if (prev == null) { seedSum += v; run++; if (run === p) { prev = seedSum / p; out[i] = prev; } continue; }
    prev = v * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}
export const rmaS = (s: Series, p: number) => emaS(s, p, 1 / p);
const zip = (a: Series, b: Series, f: (x: number, y: number) => number): Series => a.map((x, i) => (nn(x) && nn(b[i]) ? f(x, b[i] as number) : null));
const closes = (b: Bar[]) => b.map((x) => x.close);
const hl2 = (b: Bar[]) => b.map((x) => (x.high + x.low) / 2);
const tp = (b: Bar[]) => b.map((x) => (x.high + x.low + x.close) / 3);
const highs = (b: Bar[]) => b.map((x) => x.high);
const lows = (b: Bar[]) => b.map((x) => x.low);
const vols = (b: Bar[]) => b.map((x) => x.volume);
const shift = (s: Series, k: number): Series => s.map((_, i) => (i - k >= 0 && i - k < s.length ? s[i - k] : null));
const clv = (x: Bar) => (x.high === x.low ? 0 : ((x.close - x.low) - (x.high - x.close)) / (x.high - x.low));
const cum = (vals: number[]): Series => { let t = 0; return vals.map((v) => (t += v)); };

// ---------- indicator implementations ----------
export function hma(s: Series, p: number) { const half = wmaS(s, Math.max(1, Math.floor(p / 2))), full = wmaS(s, p); return wmaS(zip(half, full, (a, b) => 2 * a - b), Math.max(1, Math.round(Math.sqrt(p)))); }
export function kama(c: number[], p = 10, fast = 2, slow = 30): Series {
  const out = N(c.length);
  if (c.length <= p) return out;
  const fs = 2 / (fast + 1), ss = 2 / (slow + 1);
  let k = c[p];
  out[p] = k;
  for (let i = p + 1; i < c.length; i++) {
    let vol = 0;
    for (let j = i - p + 1; j <= i; j++) vol += Math.abs(c[j] - c[j - 1]);
    const er = vol === 0 ? 0 : Math.abs(c[i] - c[i - p]) / vol;
    const sc = (er * (fs - ss) + ss) ** 2;
    k = k + sc * (c[i] - k);
    out[i] = k;
  }
  return out;
}
/** End point of the least-squares line over the last p values (TradingView "linreg", offset 0). */
export const lsma = (s: Series, p: number) => rolling(s, p, (w) => {
  const n = w.length, mx = (n - 1) / 2, my = w.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (w[i] - my); den += (i - mx) ** 2; }
  return my + (den ? num / den : 0) * (n - 1 - mx);
});
export function alma(s: Series, p = 9, offset = 0.85, sigma = 6) {
  const m = offset * (p - 1), sd = p / sigma;
  const wts = Array.from({ length: p }, (_, i) => Math.exp(-((i - m) ** 2) / (2 * sd * sd)));
  const tw = wts.reduce((a, b) => a + b, 0);
  return rolling(s, p, (w) => w.reduce((a, v, i) => a + v * wts[i], 0) / tw);
}
export function vwma(b: Bar[], p: number) { const cv = b.map((x) => x.close * x.volume); return zip(sumS(cv, p), sumS(vols(b), p), (a, v) => (v ? a / v : NaN)).map((x) => (nn(x) ? x : null)); }
/** Rolling N-day VWAP: turnover / volume when the exchange's turnover is stored, else typical price × volume. */
export function vwapRolling(b: Bar[], p: number) { const amt = b.map((x) => (x.amount && x.amount > 0 ? x.amount : ((x.high + x.low + x.close) / 3) * x.volume)); return zip(sumS(amt, p), sumS(vols(b), p), (a, v) => (v ? a / v : NaN)).map((x) => (nn(x) ? x : null)); }
export function keltner(b: Bar[], p = 20, mult = 2, atrP = 10) { const mid = emaS(closes(b), p), a = atrN(b, atrP); return { mid, upper: zip(mid, a, (m, x) => m + mult * x), lower: zip(mid, a, (m, x) => m - mult * x) }; }
export function donchian(b: Bar[], p = 20) { const u = highestS(highs(b), p), l = lowestS(lows(b), p); return { upper: u, lower: l, mid: zip(u, l, (x, y) => (x + y) / 2) }; }
export function chandelier(b: Bar[], p = 22, mult = 3) { const a = atrN(b, p); return { long: zip(highestS(highs(b), p), a, (h, x) => h - mult * x), short: zip(lowestS(lows(b), p), a, (l, x) => l + mult * x) }; }
export function zigzag(b: Bar[], pct = 5): Series {
  const out = N(b.length);
  if (b.length < 2) return out;
  let dir = 0, pivot = 0, ext = 0;
  out[0] = b[0].close;
  for (let i = 1; i < b.length; i++) {
    const h = b[i].high, l = b[i].low;
    if (dir >= 0 && h >= b[ext].high) { if (dir === 0) dir = 1; ext = i; }
    if (dir <= 0 && l <= b[ext].low) { if (dir === 0) dir = -1; ext = i; }
    if (dir === 1 && l <= b[ext].high * (1 - pct / 100)) { out[ext] = b[ext].high; pivot = ext; dir = -1; ext = i; }
    else if (dir === -1 && h >= b[ext].low * (1 + pct / 100)) { out[ext] = b[ext].low; pivot = ext; dir = 1; ext = i; }
  }
  if (ext !== pivot) out[ext] = dir === 1 ? b[ext].high : b[ext].low;
  return out;
}
/** Classic floor pivots for each bar from the previous calendar month's high, low and close. */
export function monthlyPivots(b: Bar[]) {
  const keys = ["p", "r1", "s1", "r2", "s2", "r3", "s3"] as const;
  const out = Object.fromEntries(keys.map((k) => [k, N(b.length)])) as Record<(typeof keys)[number], Series>;
  let prev: { h: number; l: number; c: number } | null = null, cur: { m: string; h: number; l: number; c: number } | null = null;
  for (let i = 0; i < b.length; i++) {
    const m = b[i].date.slice(0, 7);
    if (!cur || cur.m !== m) { if (cur) prev = { h: cur.h, l: cur.l, c: cur.c }; cur = { m, h: b[i].high, l: b[i].low, c: b[i].close }; }
    else { cur.h = Math.max(cur.h, b[i].high); cur.l = Math.min(cur.l, b[i].low); cur.c = b[i].close; }
    if (prev) {
      const p = (prev.h + prev.l + prev.c) / 3, r = prev.h - prev.l;
      out.p[i] = p; out.r1[i] = 2 * p - prev.l; out.s1[i] = 2 * p - prev.h; out.r2[i] = p + r; out.s2[i] = p - r; out.r3[i] = prev.h + 2 * (p - prev.l); out.s3[i] = prev.l - 2 * (prev.h - p);
    }
  }
  return out;
}
export function stochRsi(c: number[], rsiP = 14, stP = 14, kS = 3, dS = 3) {
  const r = rsiN(c, rsiP);
  const hi = highestS(r, stP), lo = lowestS(r, stP);
  const raw = r.map((v, i) => (nn(v) && nn(hi[i]) && nn(lo[i]) ? ((hi[i] as number) === (lo[i] as number) ? 50 : (100 * (v - (lo[i] as number))) / ((hi[i] as number) - (lo[i] as number))) : null));
  const k = smaS(raw, kS);
  return { k, d: smaS(k, dS) };
}
export function cci(b: Bar[], p = 20) {
  const t = tp(b), m = smaS(t, p);
  return t.map((v, i) => {
    const mi = m[i]; if (!nn(mi)) return null;
    let md = 0; for (let j = i - p + 1; j <= i; j++) md += Math.abs(t[j] - mi); md /= p;
    return md === 0 ? 0 : (v - mi) / (0.015 * md);
  });
}
export const roc = (c: Series, p: number): Series => c.map((v, i) => (i >= p && nn(v) && nn(c[i - p]) && (c[i - p] as number) !== 0 ? (100 * (v - (c[i - p] as number))) / (c[i - p] as number) : null));
export function williamsR(b: Bar[], p = 14) { const h = highestS(highs(b), p), l = lowestS(lows(b), p); return b.map((x, i) => (nn(h[i]) && nn(l[i]) ? ((h[i] as number) === (l[i] as number) ? -50 : (-100 * ((h[i] as number) - x.close)) / ((h[i] as number) - (l[i] as number))) : null)); }
export function ultimate(b: Bar[], p1 = 7, p2 = 14, p3 = 28) {
  const bp = N(b.length), tr = N(b.length);
  for (let i = 1; i < b.length; i++) { const lo = Math.min(b[i].low, b[i - 1].close), hi = Math.max(b[i].high, b[i - 1].close); bp[i] = b[i].close - lo; tr[i] = hi - lo; }
  const avg = (p: number) => zip(sumS(bp, p), sumS(tr, p), (a, t) => (t ? a / t : 0));
  const a1 = avg(p1), a2 = avg(p2), a3 = avg(p3);
  return a1.map((x, i) => (nn(x) && nn(a2[i]) && nn(a3[i]) ? (100 * (4 * x + 2 * (a2[i] as number) + (a3[i] as number))) / 7 : null));
}
export function aroon(b: Bar[], p = 14) {
  const up = N(b.length), down = N(b.length);
  for (let i = p; i < b.length; i++) {
    let hi = i - p, lo = i - p;
    for (let j = i - p; j <= i; j++) { if (b[j].high >= b[hi].high) hi = j; if (b[j].low <= b[lo].low) lo = j; }
    up[i] = (100 * (p - (i - hi))) / p; down[i] = (100 * (p - (i - lo))) / p;
  }
  return { up, down, osc: zip(up, down, (u, d) => u - d) };
}
export function vortex(b: Bar[], p = 14) {
  const vp = N(b.length), vm = N(b.length), tr: Series = N(b.length);
  for (let i = 1; i < b.length; i++) { vp[i] = Math.abs(b[i].high - b[i - 1].low); vm[i] = Math.abs(b[i].low - b[i - 1].high); tr[i] = Math.max(b[i].high, b[i - 1].close) - Math.min(b[i].low, b[i - 1].close); }
  const st = sumS(tr, p);
  return { plus: zip(sumS(vp, p), st, (a, t) => (t ? a / t : 0)), minus: zip(sumS(vm, p), st, (a, t) => (t ? a / t : 0)) };
}
export function choppiness(b: Bar[], p = 14) {
  const tr = trueRange(b), st = sumS(tr, p), h = highestS(highs(b), p), l = lowestS(lows(b), p);
  return st.map((s, i) => (nn(s) && nn(h[i]) && nn(l[i]) && (h[i] as number) > (l[i] as number) ? (100 * Math.log10(s / ((h[i] as number) - (l[i] as number)))) / Math.log10(p) : null));
}
export function massIndex(b: Bar[], e = 9, p = 25) { const r = b.map((x) => x.high - x.low), e1 = emaS(r, e), e2 = emaS(e1, e); return sumS(zip(e1, e2, (a, c) => (c ? a / c : 1)), p); }
export function trix(c: number[], p = 15, sig = 9) { const e3 = emaS(emaS(emaS(c, p), p), p); const t = e3.map((v, i) => (i > 0 && nn(v) && nn(e3[i - 1]) ? (100 * (v - (e3[i - 1] as number))) / (e3[i - 1] as number) : null)); return { trix: t, signal: emaS(t, sig) }; }
export function tsi(c: number[], long = 25, short = 13, sig = 13) {
  const m: Series = c.map((v, i) => (i ? v - c[i - 1] : null)), a: Series = m.map((v) => (nn(v) ? Math.abs(v) : null));
  const t = zip(emaS(emaS(m, long), short), emaS(emaS(a, long), short), (x, y) => (y ? (100 * x) / y : 0));
  return { tsi: t, signal: emaS(t, sig) };
}
export function fisher(b: Bar[], p = 9) {
  const h = hl2(b), hi = highestS(h, p), lo = lowestS(h, p);
  const f = N(b.length), trig = N(b.length);
  let v = 0, fp = 0;
  for (let i = 0; i < b.length; i++) {
    if (!nn(hi[i]) || !nn(lo[i])) continue;
    const rng = (hi[i] as number) - (lo[i] as number);
    v = 0.66 * ((rng ? (h[i] - (lo[i] as number)) / rng : 0.5) - 0.5) + 0.67 * v;
    v = Math.max(-0.999, Math.min(0.999, v));
    const fv = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * fp;
    trig[i] = fp; f[i] = fv; fp = fv;
  }
  return { fisher: f, trigger: trig };
}
export function mfi(b: Bar[], p = 14) {
  const t = tp(b), out = N(b.length);
  for (let i = p; i < b.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - p + 1; j <= i; j++) { const f = t[j] * b[j].volume; if (t[j] > t[j - 1]) pos += f; else if (t[j] < t[j - 1]) neg += f; }
    out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
  }
  return out;
}
export const adLine = (b: Bar[]) => cum(b.map((x) => clv(x) * x.volume));
export function cmf(b: Bar[], p = 20) { return zip(sumS(b.map((x) => clv(x) * x.volume), p), sumS(vols(b), p), (a, v) => (v ? a / v : 0)); }
export function chaikinOsc(b: Bar[], f = 3, s = 10) { const ad = adLine(b); return zip(emaS(ad, f), emaS(ad, s), (a, c) => a - c); }
export function forceIndex(b: Bar[], p = 13) { return emaS(b.map((x, i) => (i ? (x.close - b[i - 1].close) * x.volume : null)), p); }
export function eom(b: Bar[], p = 14) { const h = hl2(b); return smaS(b.map((x, i) => (i && x.volume ? (10000 * (h[i] - h[i - 1]) * (x.high - x.low)) / x.volume : i ? 0 : null)), p); }
export function pvt(b: Bar[]) { let t = 0; return b.map((x, i) => (i ? (t += b[i - 1].close ? ((x.close - b[i - 1].close) / b[i - 1].close) * x.volume : 0) : 0)); }
export function histVol(c: number[], p = 20, perYear = 240) { const r: Series = c.map((v, i) => (i && c[i - 1] > 0 && v > 0 ? Math.log(v / c[i - 1]) : null)); return rolling(r, p, (w) => { const m = w.reduce((a, b) => a + b, 0) / p; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (p - 1)) * Math.sqrt(perYear) * 100; }); }
export function ulcer(c: number[], p = 14) { const mx = highestS(c, p); const dd = c.map((v, i) => (nn(mx[i]) ? ((v - (mx[i] as number)) / (mx[i] as number)) * 100 : null)); return rolling(dd, p, (w) => Math.sqrt(w.reduce((a, b) => a + b * b, 0) / p)); }
export function coppock(c: number[], w = 10, l = 14, s = 11) { return wmaS(zip(roc(c, l), roc(c, s), (a, b) => a + b), w); }

// ---------- registry ----------
const P = (key: string, label: string, def: number, min = 1, max = 500, step = 1): ParamDef => ({ key, label, def, min, max, step });
const O = (key: string, label: string, color: string, extra: Partial<OutputDef> = {}): OutputDef => ({ key, label, color, ...extra });
const ma = (id: string, name: string, desc: string, f: (b: Bar[], n: number) => Series, def = 20, color = "#f59e0b"): IndicatorDef =>
  ({ id, name, short: id.toUpperCase(), group: "Moving averages", overlay: true, desc, params: [P("length", "Length", def)], outputs: [O("v", name, color, { width: 2 })], compute: (b, p) => ({ v: f(b, p.length) }) });

export const INDICATORS: IndicatorDef[] = [
  ma("sma", "Simple moving average", "Average close over the last N sessions. Price above a rising SMA = uptrend.", (b, n) => smaN(closes(b), n), 50, "#60a5fa"),
  ma("ema", "Exponential moving average", "Weights recent prices more, so it reacts faster than the SMA.", (b, n) => emaN(closes(b), n), 20, "#34d399"),
  ma("wma", "Weighted moving average", "Linearly weighted average: the latest session counts N times, the oldest once.", (b, n) => wmaS(closes(b), n), 20, "#fbbf24"),
  ma("dema", "Double EMA", "2×EMA − EMA(EMA): less lag than a plain EMA.", (b, n) => { const e = emaS(closes(b), n); return zip(e, emaS(e, n), (a, c) => 2 * a - c); }, 20, "#f472b6"),
  ma("tema", "Triple EMA", "3×EMA − 3×EMA² + EMA³: very low lag.", (b, n) => { const e1 = emaS(closes(b), n), e2 = emaS(e1, n), e3 = emaS(e2, n); return e1.map((x, i) => (nn(x) && nn(e2[i]) && nn(e3[i]) ? 3 * x - 3 * (e2[i] as number) + (e3[i] as number) : null)); }, 20, "#c084fc"),
  ma("hma", "Hull moving average", "WMA of (2×WMA(N/2) − WMA(N)) over √N: smooth and fast.", (b, n) => hma(closes(b), n), 21, "#22d3ee"),
  ma("smma", "Smoothed MA (RMA)", "Wilder's smoothing, the average used inside RSI and ATR.", (b, n) => rmaS(closes(b), n), 20, "#a3e635"),
  ma("vwma", "Volume-weighted MA", "Average close weighted by each session's volume.", (b, n) => vwma(b, n), 20, "#fb923c"),
  ma("lsma", "Least squares MA", "End point of a straight line fitted to the last N closes.", (b, n) => lsma(closes(b), n), 25, "#e879f9"),
  { id: "alma", name: "Arnaud Legoux MA", short: "ALMA", group: "Moving averages", overlay: true, desc: "Gaussian-weighted average that reduces lag and noise.", params: [P("length", "Length", 9), P("offset", "Offset", 0.85, 0, 1, 0.05), P("sigma", "Sigma", 6, 1, 20, 0.5)], outputs: [O("v", "ALMA", "#2dd4bf", { width: 2 })], compute: (b, p) => ({ v: alma(closes(b), p.length, p.offset, p.sigma) }) },
  { id: "kama", name: "Kaufman adaptive MA", short: "KAMA", group: "Moving averages", overlay: true, desc: "Speeds up in trends and flattens in noise (efficiency ratio).", params: [P("length", "ER length", 10), P("fast", "Fast", 2), P("slow", "Slow", 30)], outputs: [O("v", "KAMA", "#facc15", { width: 2 })], compute: (b, p) => ({ v: kama(closes(b), p.length, p.fast, p.slow) }) },
  { id: "macross", name: "MA cross (fast/slow)", short: "MA×", group: "Moving averages", overlay: true, desc: "Two averages: fast crossing above slow is a golden cross; below is a death cross.", params: [P("fast", "Fast SMA", 50), P("slow", "Slow SMA", 200)], outputs: [O("fast", "Fast", "#60a5fa", { width: 2 }), O("slow", "Slow", "#a78bfa", { width: 2 })], compute: (b, p) => ({ fast: smaN(closes(b), p.fast), slow: smaN(closes(b), p.slow) }) },
  { id: "ribbon", name: "EMA ribbon (20/50/100/200)", short: "Ribbon", group: "Moving averages", overlay: true, desc: "Four EMAs; stacked in order = strong trend, tangled = no trend.", params: [], outputs: [O("e20", "EMA 20", "#34d399"), O("e50", "EMA 50", "#60a5fa"), O("e100", "EMA 100", "#f59e0b"), O("e200", "EMA 200", "#a78bfa")], compute: (b) => { const c = closes(b); return { e20: emaN(c, 20), e50: emaN(c, 50), e100: emaN(c, 100), e200: emaN(c, 200) }; } },

  { id: "vwap", name: "VWAP (rolling N-day)", short: "VWAP", group: "Trend", overlay: true, desc: "Average price paid per share over the last N sessions (exchange turnover ÷ volume). NEPSE intraday ticks aren't available, so this is a multi-day VWAP, not a session VWAP.", params: [P("length", "Days", 20)], outputs: [O("v", "VWAP", "#f97316", { width: 2 })], compute: (b, p) => ({ v: vwapRolling(b, p.length) }) },
  { id: "bb", name: "Bollinger Bands", short: "BB", group: "Volatility", overlay: true, desc: "SMA ± K standard deviations. Bands squeeze before big moves; a close outside the band is stretched.", params: [P("length", "Length", 20), P("mult", "Std dev", 2, 0.5, 5, 0.1)], outputs: [O("upper", "Upper", "#94a3b8"), O("middle", "Basis", "#f59e0b", { dashed: true }), O("lower", "Lower", "#94a3b8")], compute: (b, p) => { const x = bbN(closes(b), p.length, p.mult); return { upper: x.upper, middle: x.middle, lower: x.lower }; } },
  { id: "kc", name: "Keltner Channels", short: "KC", group: "Volatility", overlay: true, desc: "EMA ± K × ATR. Bollinger inside Keltner = a volatility squeeze.", params: [P("length", "EMA", 20), P("mult", "ATR ×", 2, 0.5, 5, 0.1), P("atr", "ATR length", 10)], outputs: [O("upper", "Upper", "#38bdf8"), O("mid", "Basis", "#38bdf8", { dashed: true }), O("lower", "Lower", "#38bdf8")], compute: (b, p) => keltner(b, p.length, p.mult, p.atr) },
  { id: "dc", name: "Donchian Channels", short: "DC", group: "Volatility", overlay: true, desc: "Highest high and lowest low of N sessions: a close above the top is an N-day breakout.", params: [P("length", "Length", 20)], outputs: [O("upper", "Upper", "#22c55e"), O("mid", "Mid", "#64748b", { dashed: true }), O("lower", "Lower", "#ef4444")], compute: (b, p) => donchian(b, p.length) },
  { id: "env", name: "Moving average envelope", short: "Env", group: "Volatility", overlay: true, desc: "SMA ± a fixed percentage.", params: [P("length", "Length", 20), P("pct", "Percent", 5, 0.5, 30, 0.5)], outputs: [O("upper", "Upper", "#a78bfa"), O("mid", "Basis", "#a78bfa", { dashed: true }), O("lower", "Lower", "#a78bfa")], compute: (b, p) => { const m = smaN(closes(b), p.length); return { mid: m, upper: m.map((x) => (nn(x) ? x * (1 + p.pct / 100) : null)), lower: m.map((x) => (nn(x) ? x * (1 - p.pct / 100) : null)) }; } },
  { id: "ichimoku", name: "Ichimoku Cloud", short: "Ichimoku", group: "Trend", overlay: true, desc: "Tenkan, Kijun, cloud (Senkou A/B, plotted 26 ahead) and Chikou (close plotted 26 back). Price above the cloud = bullish.", params: [P("conv", "Tenkan", 9), P("base", "Kijun", 26), P("spanB", "Senkou B", 52), P("disp", "Displacement", 26)], outputs: [O("tenkan", "Tenkan", "#3b82f6"), O("kijun", "Kijun", "#ef4444"), O("senkouA", "Senkou A", "#22c55e"), O("senkouB", "Senkou B", "#f43f5e"), O("chikou", "Chikou", "#a3a3a3", { dashed: true })], compute: (b, p) => { const x = ichN(b, p.conv, p.base, p.spanB, p.disp); return { tenkan: x.tenkan, kijun: x.kijun, senkouA: x.senkouA, senkouB: x.senkouB, chikou: shift(closes(b), -p.disp) }; } },
  { id: "supertrend", name: "Supertrend", short: "ST", group: "Trend", overlay: true, desc: "ATR trailing line: green under price in uptrends, red above price in downtrends. A flip is a trend change.", params: [P("length", "ATR length", 10), P("mult", "Multiplier", 3, 0.5, 10, 0.1)], outputs: [O("up", "Up", "#22c55e", { width: 2 }), O("down", "Down", "#ef4444", { width: 2 })], compute: (b, p) => { const x = stN(b, p.length, p.mult); return { up: x.line.map((v, i) => (x.direction[i] === 1 ? v : null)), down: x.line.map((v, i) => (x.direction[i] === -1 ? v : null)) }; } },
  { id: "psar", name: "Parabolic SAR", short: "SAR", group: "Trend", overlay: true, desc: "Stop-and-reverse dots: below price in uptrends, above in downtrends.", params: [P("step", "Step", 0.02, 0.005, 0.2, 0.005), P("max", "Max", 0.2, 0.05, 1, 0.05)], outputs: [O("v", "SAR", "#eab308", { kind: "dots" })], compute: (b, p) => ({ v: psarN(b, p.step, p.max) }) },
  { id: "chandelier", name: "Chandelier exit", short: "CE", group: "Trend", overlay: true, desc: "Trailing stop: highest high − K × ATR for longs.", params: [P("length", "Length", 22), P("mult", "ATR ×", 3, 0.5, 10, 0.1)], outputs: [O("long", "Long stop", "#22c55e", { dashed: true }), O("short", "Short stop", "#ef4444", { dashed: true })], compute: (b, p) => chandelier(b, p.length, p.mult) },
  { id: "zigzag", name: "ZigZag", short: "ZZ", group: "Trend", overlay: true, desc: "Connects swing highs and lows that differ by at least X%: shows market structure (higher highs, lower lows).", params: [P("pct", "Deviation %", 5, 1, 30, 0.5)], outputs: [O("v", "ZigZag", "#f97316", { connect: true, width: 2 })], compute: (b, p) => ({ v: zigzag(b, p.pct) }) },
  { id: "pivots", name: "Pivot points (monthly)", short: "Pivots", group: "Trend", overlay: true, desc: "Classic floor pivots from last month's high, low and close.", params: [], outputs: [O("r2", "R2", "#ef4444", { kind: "step" }), O("r1", "R1", "#f87171", { kind: "step" }), O("p", "P", "#f59e0b", { kind: "step" }), O("s1", "S1", "#4ade80", { kind: "step" }), O("s2", "S2", "#22c55e", { kind: "step" })], compute: (b) => monthlyPivots(b) },

  { id: "rsi", name: "Relative Strength Index", short: "RSI", group: "Momentum", overlay: false, desc: "Wilder's RSI (0–100). Above 70 overbought, below 30 oversold; 50 splits bull and bear.", params: [P("length", "Length", 14), P("ma", "Signal MA", 14)], outputs: [O("v", "RSI", "#a78bfa", { width: 2 }), O("ma", "MA", "#f59e0b")], levels: [70, 50, 30], compute: (b, p) => { const r = rsiN(closes(b), p.length); return { v: r, ma: smaS(r, p.ma) }; } },
  { id: "macd", name: "MACD", short: "MACD", group: "Momentum", overlay: false, desc: "EMA(12) − EMA(26) with a 9-EMA signal. Crossing the signal and the zero line marks momentum shifts.", params: [P("fast", "Fast", 12), P("slow", "Slow", 26), P("signal", "Signal", 9)], outputs: [O("hist", "Histogram", "#64748b", { kind: "histogram" }), O("macd", "MACD", "#3b82f6", { width: 2 }), O("signal", "Signal", "#f97316")], levels: [0], compute: (b, p) => { const x = macdN(closes(b), p.fast, p.slow, p.signal); return { macd: x.macd, signal: x.signal, hist: x.histogram }; } },
  { id: "stoch", name: "Stochastic", short: "Stoch", group: "Momentum", overlay: false, desc: "Where the close sits in the N-session range (0–100). %K crossing %D below 20 is a buy cue.", params: [P("k", "%K", 14), P("d", "%D", 3), P("smooth", "Smooth", 3)], outputs: [O("k", "%K", "#3b82f6", { width: 2 }), O("d", "%D", "#f97316")], levels: [80, 20], compute: (b, p) => stochN(b, p.k, p.d, p.smooth) },
  { id: "stochrsi", name: "Stochastic RSI", short: "StochRSI", group: "Momentum", overlay: false, desc: "Stochastic applied to RSI: faster and more sensitive.", params: [P("rsi", "RSI", 14), P("stoch", "Stoch", 14), P("k", "%K", 3), P("d", "%D", 3)], outputs: [O("k", "%K", "#3b82f6", { width: 2 }), O("d", "%D", "#f97316")], levels: [80, 20], compute: (b, p) => stochRsi(closes(b), p.rsi, p.stoch, p.k, p.d) },
  { id: "cci", name: "Commodity Channel Index", short: "CCI", group: "Momentum", overlay: false, desc: "Distance of typical price from its average in mean deviations. ±100 marks strong moves.", params: [P("length", "Length", 20)], outputs: [O("v", "CCI", "#14b8a6", { width: 2 })], levels: [100, 0, -100], compute: (b, p) => ({ v: cci(b, p.length) }) },
  { id: "roc", name: "Rate of change", short: "ROC", group: "Momentum", overlay: false, desc: "% change over N sessions.", params: [P("length", "Length", 12)], outputs: [O("v", "ROC %", "#0ea5e9", { width: 2 })], levels: [0], compute: (b, p) => ({ v: roc(closes(b), p.length) }) },
  { id: "willr", name: "Williams %R", short: "%R", group: "Momentum", overlay: false, desc: "Close vs the N-session high (0 to −100). Above −20 overbought, below −80 oversold.", params: [P("length", "Length", 14)], outputs: [O("v", "%R", "#e879f9", { width: 2 })], levels: [-20, -80], compute: (b, p) => ({ v: williamsR(b, p.length) }) },
  { id: "mom", name: "Momentum", short: "MOM", group: "Momentum", overlay: false, desc: "Close − close N sessions ago.", params: [P("length", "Length", 10)], outputs: [O("v", "Momentum", "#38bdf8", { width: 2 })], levels: [0], compute: (b, p) => { const c = closes(b); return { v: c.map((v, i) => (i >= p.length ? v - c[i - p.length] : null)) }; } },
  { id: "uo", name: "Ultimate Oscillator", short: "UO", group: "Momentum", overlay: false, desc: "Buying pressure over 7, 14 and 28 sessions combined (0–100).", params: [P("p1", "Short", 7), P("p2", "Mid", 14), P("p3", "Long", 28)], outputs: [O("v", "UO", "#f472b6", { width: 2 })], levels: [70, 50, 30], compute: (b, p) => ({ v: ultimate(b, p.p1, p.p2, p.p3) }) },
  { id: "ao", name: "Awesome Oscillator", short: "AO", group: "Momentum", overlay: false, desc: "SMA(5) − SMA(34) of the bar midpoint.", params: [P("fast", "Fast", 5), P("slow", "Slow", 34)], outputs: [O("v", "AO", "#22c55e", { kind: "histogram" })], levels: [0], compute: (b, p) => { const m = hl2(b); return { v: zip(smaS(m, p.fast), smaS(m, p.slow), (a, c) => a - c) }; } },
  { id: "ppo", name: "Percentage Price Oscillator", short: "PPO", group: "Momentum", overlay: false, desc: "MACD expressed as a % of the slow EMA, so it compares across prices.", params: [P("fast", "Fast", 12), P("slow", "Slow", 26), P("signal", "Signal", 9)], outputs: [O("hist", "Histogram", "#64748b", { kind: "histogram" }), O("ppo", "PPO", "#3b82f6", { width: 2 }), O("signal", "Signal", "#f97316")], levels: [0], compute: (b, p) => { const c = closes(b); const v = zip(emaS(c, p.fast), emaS(c, p.slow), (f, s) => ((f - s) / s) * 100); const sg = emaS(v, p.signal); return { ppo: v, signal: sg, hist: zip(v, sg, (a, c2) => a - c2) }; } },
  { id: "dpo", name: "Detrended Price Oscillator", short: "DPO", group: "Momentum", overlay: false, desc: "Close minus a shifted SMA: reveals cycles without the trend.", params: [P("length", "Length", 20)], outputs: [O("v", "DPO", "#f59e0b", { width: 2 })], levels: [0], compute: (b, p) => { const m = shift(smaN(closes(b), p.length), Math.floor(p.length / 2) + 1); return { v: b.map((x, i) => (nn(m[i]) ? x.close - (m[i] as number) : null)) }; } },
  { id: "trix", name: "TRIX", short: "TRIX", group: "Momentum", overlay: false, desc: "1-session % change of a triple-smoothed EMA.", params: [P("length", "Length", 15), P("signal", "Signal", 9)], outputs: [O("trix", "TRIX", "#ef4444", { width: 2 }), O("signal", "Signal", "#64748b")], levels: [0], compute: (b, p) => trix(closes(b), p.length, p.signal) },
  { id: "tsi", name: "True Strength Index", short: "TSI", group: "Momentum", overlay: false, desc: "Double-smoothed momentum (−100 to 100).", params: [P("long", "Long", 25), P("short", "Short", 13), P("signal", "Signal", 13)], outputs: [O("tsi", "TSI", "#3b82f6", { width: 2 }), O("signal", "Signal", "#f43f5e")], levels: [0], compute: (b, p) => tsi(closes(b), p.long, p.short, p.signal) },
  { id: "fisher", name: "Fisher Transform", short: "Fisher", group: "Momentum", overlay: false, desc: "Turns price into a near-normal distribution so turning points stand out.", params: [P("length", "Length", 9)], outputs: [O("fisher", "Fisher", "#3b82f6", { width: 2 }), O("trigger", "Trigger", "#f97316")], levels: [1.5, 0, -1.5], compute: (b, p) => fisher(b, p.length) },
  { id: "coppock", name: "Coppock Curve", short: "Coppock", group: "Momentum", overlay: false, desc: "Long-term momentum; a turn up from below zero has marked major bottoms.", params: [P("wma", "WMA", 10), P("long", "Long ROC", 14), P("short", "Short ROC", 11)], outputs: [O("v", "Coppock", "#0ea5e9", { width: 2 })], levels: [0], compute: (b, p) => ({ v: coppock(closes(b), p.wma, p.long, p.short) }) },
  { id: "elder", name: "Elder Ray (bull/bear power)", short: "Elder", group: "Momentum", overlay: false, desc: "High − EMA (bull power) and low − EMA (bear power).", params: [P("length", "EMA", 13)], outputs: [O("bull", "Bull power", "#22c55e", { kind: "histogram" }), O("bear", "Bear power", "#ef4444", { kind: "histogram" })], levels: [0], compute: (b, p) => { const e = emaN(closes(b), p.length); return { bull: b.map((x, i) => (nn(e[i]) ? x.high - (e[i] as number) : null)), bear: b.map((x, i) => (nn(e[i]) ? x.low - (e[i] as number) : null)) }; } },

  { id: "adx", name: "ADX / DMI", short: "ADX", group: "Trend", overlay: false, desc: "ADX above 25 = trending; +DI above −DI = buyers in control.", params: [P("length", "Length", 14)], outputs: [O("adx", "ADX", "#f59e0b", { width: 2 }), O("plus", "+DI", "#22c55e"), O("minus", "−DI", "#ef4444")], levels: [25, 20], compute: (b, p) => { const x = adxN(b, p.length); return { adx: x.adx, plus: x.plusDI, minus: x.minusDI }; } },
  { id: "aroon", name: "Aroon", short: "Aroon", group: "Trend", overlay: false, desc: "How recently the N-session high/low happened (0–100). Up above Down = uptrend.", params: [P("length", "Length", 14)], outputs: [O("up", "Up", "#22c55e", { width: 2 }), O("down", "Down", "#ef4444", { width: 2 })], levels: [70, 30], compute: (b, p) => { const x = aroon(b, p.length); return { up: x.up, down: x.down }; } },
  { id: "aroonosc", name: "Aroon Oscillator", short: "AroonOsc", group: "Trend", overlay: false, desc: "Aroon Up − Aroon Down.", params: [P("length", "Length", 14)], outputs: [O("v", "Osc", "#0ea5e9", { kind: "histogram" })], levels: [0], compute: (b, p) => ({ v: aroon(b, p.length).osc }) },
  { id: "vortex", name: "Vortex", short: "VI", group: "Trend", overlay: false, desc: "VI+ crossing above VI− starts an uptrend.", params: [P("length", "Length", 14)], outputs: [O("plus", "VI+", "#22c55e", { width: 2 }), O("minus", "VI−", "#ef4444", { width: 2 })], levels: [1], compute: (b, p) => vortex(b, p.length) },
  { id: "chop", name: "Choppiness Index", short: "CHOP", group: "Trend", overlay: false, desc: "Above 61.8 = choppy/sideways, below 38.2 = trending.", params: [P("length", "Length", 14)], outputs: [O("v", "CHOP", "#a3a3a3", { width: 2 })], levels: [61.8, 38.2], compute: (b, p) => ({ v: choppiness(b, p.length) }) },
  { id: "mass", name: "Mass Index", short: "Mass", group: "Volatility", overlay: false, desc: "Range expansion; a bulge above 27 then back below 26.5 warns of a reversal.", params: [P("ema", "EMA", 9), P("sum", "Sum", 25)], outputs: [O("v", "Mass", "#f43f5e", { width: 2 })], levels: [27, 26.5], compute: (b, p) => ({ v: massIndex(b, p.ema, p.sum) }) },

  { id: "atr", name: "Average True Range", short: "ATR", group: "Volatility", overlay: false, desc: "Average daily range in rupees (Wilder). Use it to size stops.", params: [P("length", "Length", 14)], outputs: [O("v", "ATR", "#f43f5e", { width: 2 })], compute: (b, p) => ({ v: atrN(b, p.length) }) },
  { id: "atrp", name: "ATR %", short: "ATR%", group: "Volatility", overlay: false, desc: "ATR as a % of price: comparable across stocks.", params: [P("length", "Length", 14)], outputs: [O("v", "ATR %", "#fb7185", { width: 2 })], compute: (b, p) => { const a = atrN(b, p.length); return { v: a.map((x, i) => (nn(x) ? (x / b[i].close) * 100 : null)) }; } },
  { id: "bbw", name: "Bollinger Bandwidth", short: "BBW", group: "Volatility", overlay: false, desc: "Band width as a % of the basis; lows mark squeezes.", params: [P("length", "Length", 20), P("mult", "Std dev", 2, 0.5, 5, 0.1)], outputs: [O("v", "Bandwidth %", "#94a3b8", { width: 2 })], compute: (b, p) => { const x = bbN(closes(b), p.length, p.mult); return { v: x.upper.map((u, i) => (nn(u) && nn(x.lower[i]) && nn(x.middle[i]) ? ((u - (x.lower[i] as number)) / (x.middle[i] as number)) * 100 : null)) }; } },
  { id: "bbp", name: "Bollinger %B", short: "%B", group: "Volatility", overlay: false, desc: "Where the close sits inside the bands (0 = lower, 1 = upper).", params: [P("length", "Length", 20), P("mult", "Std dev", 2, 0.5, 5, 0.1)], outputs: [O("v", "%B", "#94a3b8", { width: 2 })], levels: [1, 0.5, 0], compute: (b, p) => { const x = bbN(closes(b), p.length, p.mult); return { v: b.map((bar, i) => (nn(x.upper[i]) && nn(x.lower[i]) && (x.upper[i] as number) !== (x.lower[i] as number) ? (bar.close - (x.lower[i] as number)) / ((x.upper[i] as number) - (x.lower[i] as number)) : null)) }; } },
  { id: "stdev", name: "Standard deviation", short: "StdDev", group: "Volatility", overlay: false, desc: "Population standard deviation of closes.", params: [P("length", "Length", 20)], outputs: [O("v", "StdDev", "#cbd5e1", { width: 2 })], compute: (b, p) => ({ v: stdevS(closes(b), p.length) }) },
  { id: "hv", name: "Historical volatility", short: "HV", group: "Volatility", overlay: false, desc: "Annualised standard deviation of daily log returns (×√240 NEPSE sessions).", params: [P("length", "Length", 20)], outputs: [O("v", "HV %", "#fda4af", { width: 2 })], compute: (b, p) => ({ v: histVol(closes(b), p.length) }) },
  { id: "ulcer", name: "Ulcer Index", short: "Ulcer", group: "Volatility", overlay: false, desc: "Depth and length of drawdowns from the recent high.", params: [P("length", "Length", 14)], outputs: [O("v", "Ulcer", "#f87171", { width: 2 })], compute: (b, p) => ({ v: ulcer(closes(b), p.length) }) },

  { id: "volume", name: "Volume", short: "Vol", group: "Volume", overlay: false, desc: "Shares traded per session with its moving average.", params: [P("ma", "MA", 20)], outputs: [O("v", "Volume", "#64748b", { kind: "histogram" }), O("ma", "MA", "#f59e0b")], compute: (b, p) => ({ v: vols(b), ma: smaN(vols(b), p.ma) }) },
  { id: "relvol", name: "Relative volume", short: "RVOL", group: "Volume", overlay: false, desc: "Volume ÷ its N-session average. Above 1.5 = unusual interest.", params: [P("length", "Length", 20)], outputs: [O("v", "RVOL", "#0ea5e9", { kind: "histogram" })], levels: [1.5, 1], compute: (b, p) => { const m = smaN(vols(b), p.length); return { v: b.map((x, i) => (nn(m[i]) && (m[i] as number) > 0 ? x.volume / (m[i] as number) : null)) }; } },
  { id: "turnover", name: "Turnover (Rs.)", short: "Turnover", group: "Volume", overlay: false, desc: "Rupee value traded per session (from the exchange).", params: [], outputs: [O("v", "Turnover", "#14b8a6", { kind: "histogram" })], compute: (b) => ({ v: b.map((x) => (x.amount && x.amount > 0 ? x.amount : null)) }) },
  { id: "obv", name: "On-Balance Volume", short: "OBV", group: "Volume", overlay: false, desc: "Running total of volume on up days minus down days. Rising OBV with flat price = accumulation.", params: [P("ma", "Signal EMA", 20)], outputs: [O("v", "OBV", "#3b82f6", { width: 2 }), O("ma", "EMA", "#f59e0b")], compute: (b, p) => { const o = obvN(b); return { v: o, ma: emaS(o, p.ma) }; } },
  { id: "mfi", name: "Money Flow Index", short: "MFI", group: "Volume", overlay: false, desc: "Volume-weighted RSI (0–100). Above 80 overbought, below 20 oversold.", params: [P("length", "Length", 14)], outputs: [O("v", "MFI", "#22c55e", { width: 2 })], levels: [80, 50, 20], compute: (b, p) => ({ v: mfi(b, p.length) }) },
  { id: "ad", name: "Accumulation / Distribution", short: "A/D", group: "Volume", overlay: false, desc: "Volume weighted by where each close sits in its range, summed over time.", params: [], outputs: [O("v", "A/D", "#a78bfa", { width: 2 })], compute: (b) => ({ v: adLine(b) }) },
  { id: "cmf", name: "Chaikin Money Flow", short: "CMF", group: "Volume", overlay: false, desc: "A/D over N sessions ÷ volume. Above 0 = buying pressure.", params: [P("length", "Length", 20)], outputs: [O("v", "CMF", "#10b981", { kind: "histogram" })], levels: [0.1, 0, -0.1], compute: (b, p) => ({ v: cmf(b, p.length) }) },
  { id: "chaikin", name: "Chaikin Oscillator", short: "ChaikinOsc", group: "Volume", overlay: false, desc: "EMA(3) − EMA(10) of the A/D line.", params: [P("fast", "Fast", 3), P("slow", "Slow", 10)], outputs: [O("v", "Osc", "#f59e0b", { width: 2 })], levels: [0], compute: (b, p) => ({ v: chaikinOsc(b, p.fast, p.slow) }) },
  { id: "force", name: "Force Index", short: "FI", group: "Volume", overlay: false, desc: "Price change × volume, smoothed: the force behind each move.", params: [P("length", "EMA", 13)], outputs: [O("v", "Force", "#ef4444", { width: 2 })], levels: [0], compute: (b, p) => ({ v: forceIndex(b, p.length) }) },
  { id: "eom", name: "Ease of Movement", short: "EOM", group: "Volume", overlay: false, desc: "How easily price moves per unit of volume.", params: [P("length", "Length", 14)], outputs: [O("v", "EOM", "#06b6d4", { width: 2 })], levels: [0], compute: (b, p) => ({ v: eom(b, p.length) }) },
  { id: "pvt", name: "Price Volume Trend", short: "PVT", group: "Volume", overlay: false, desc: "Running total of volume × % price change.", params: [], outputs: [O("v", "PVT", "#8b5cf6", { width: 2 })], compute: (b) => ({ v: pvt(b) }) },
  { id: "vo", name: "Volume Oscillator", short: "VO", group: "Volume", overlay: false, desc: "% gap between a fast and slow volume EMA.", params: [P("fast", "Fast", 5), P("slow", "Slow", 10)], outputs: [O("v", "VO %", "#0ea5e9", { width: 2 })], levels: [0], compute: (b, p) => { const v = vols(b); return { v: zip(emaS(v, p.fast), emaS(v, p.slow), (f, s) => (s ? ((f - s) / s) * 100 : 0)) }; } },
];

export const INDICATOR_MAP = new Map(INDICATORS.map((d) => [d.id, d]));
export const defaults = (d: IndicatorDef) => Object.fromEntries(d.params.map((p) => [p.key, p.def]));
