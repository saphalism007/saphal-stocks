// Deterministic technical indicators. Every function returns a series aligned
// to the input bars (null where there is not enough history yet).
import type { Bar, Series } from "./types.ts";

const nulls = (n: number): Series => new Array(n).fill(null);

export function sma(values: number[], period: number): Series {
  const out = nulls(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values (standard convention). */
export function ema(values: number[], period: number): Series {
  const out = nulls(values.length);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (RMA), used by RSI, ATR and ADX. */
function rma(values: number[], period: number, start = 0): Series {
  const out = nulls(values.length);
  if (values.length - start < period) return out;
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): Series {
  const out = nulls(closes.length);
  if (closes.length <= period) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = rma(gains, period, 1);
  const al = rma(losses, period, 1);
  for (let i = 0; i < closes.length; i++) {
    const g = ag[i];
    const l = al[i];
    if (g == null || l == null) continue;
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line: Series = closes.map((_, i) => (ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null));
  const firstIdx = line.findIndex((v) => v != null);
  const sig = nulls(closes.length);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const e = ema(compact, signal);
    e.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist: Series = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { macd: line, signal: sig, histogram: hist };
}

export function stddev(values: number[], period: number): Series {
  const out = nulls(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let m = 0;
    for (let j = i - period + 1; j <= i; j++) m += values[j];
    m /= period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    out[i] = Math.sqrt(v / period); // population SD, as TradingView/Bollinger use
  }
  return out;
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const sd = stddev(closes, period);
  const upper: Series = mid.map((m, i) => (m != null ? m + mult * (sd[i] as number) : null));
  const lower: Series = mid.map((m, i) => (m != null ? m - mult * (sd[i] as number) : null));
  const bandwidth: Series = mid.map((m, i) => (m ? ((upper[i] as number) - (lower[i] as number)) / m : null));
  const percentB: Series = closes.map((c, i) =>
    upper[i] != null && upper[i] !== lower[i] ? (c - (lower[i] as number)) / ((upper[i] as number) - (lower[i] as number)) : null,
  );
  return { middle: mid, upper, lower, bandwidth, percentB };
}

export function trueRange(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

export function atr(bars: Bar[], period = 14): Series {
  return rma(trueRange(bars), period);
}

export function stochastic(bars: Bar[], kPeriod = 14, dPeriod = 3, smooth = 3) {
  const rawK = nulls(bars.length);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].high);
      ll = Math.min(ll, bars[j].low);
    }
    rawK[i] = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
  }
  const k = smoothSeries(rawK, smooth);
  const d = smoothSeries(k, dPeriod);
  return { k, d };
}

function smoothSeries(s: Series, period: number): Series {
  const first = s.findIndex((v) => v != null);
  const out = nulls(s.length);
  if (first < 0) return out;
  const vals = s.slice(first) as number[];
  sma(vals, period).forEach((v, j) => (out[first + j] = v));
  return out;
}

export function adx(bars: Bar[], period = 14) {
  const n = bars.length;
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(bars);
  const sTR = rma(tr, period, 1);
  const sP = rma(plusDM, period, 1);
  const sM = rma(minusDM, period, 1);
  const plusDI = nulls(n);
  const minusDI = nulls(n);
  const dx: number[] = new Array(n).fill(0);
  let firstDx = -1;
  for (let i = 0; i < n; i++) {
    if (sTR[i] == null || !sTR[i]) continue;
    const p = (100 * (sP[i] as number)) / (sTR[i] as number);
    const m = (100 * (sM[i] as number)) / (sTR[i] as number);
    plusDI[i] = p;
    minusDI[i] = m;
    dx[i] = p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m);
    if (firstDx < 0) firstDx = i;
  }
  const adxS = firstDx >= 0 ? rma(dx, period, firstDx) : nulls(n);
  return { adx: adxS, plusDI, minusDI };
}

export function obv(bars: Bar[]): number[] {
  const out: number[] = [];
  let v = 0;
  bars.forEach((b, i) => {
    if (i > 0) {
      if (b.close > bars[i - 1].close) v += b.volume;
      else if (b.close < bars[i - 1].close) v -= b.volume;
    }
    out.push(v);
  });
  return out;
}

/**
 * Daily VWAP from turnover / volume (exact for NEPSE end-of-day data, since
 * turnover is the sum of price x quantity), plus an N-day rolling VWAP.
 */
export function vwap(bars: Bar[], period = 20) {
  const daily: Series = bars.map((b) => (b.amount && b.volume ? b.amount / b.volume : null));
  const rolling = nulls(bars.length);
  for (let i = period - 1; i < bars.length; i++) {
    let amt = 0;
    let vol = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].amount == null) { ok = false; break; }
      amt += bars[j].amount as number;
      vol += bars[j].volume;
    }
    if (ok && vol > 0) rolling[i] = amt / vol;
  }
  return { daily, rolling };
}

export function ichimoku(bars: Bar[], conv = 9, base = 26, spanB = 52, disp = 26) {
  const mid = (p: number, i: number) => {
    if (i < p - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - p + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].high);
      ll = Math.min(ll, bars[j].low);
    }
    return (hh + ll) / 2;
  };
  const n = bars.length;
  const tenkan: Series = bars.map((_, i) => mid(conv, i));
  const kijun: Series = bars.map((_, i) => mid(base, i));
  // Spans are plotted `disp` bars ahead; here senkouA[i] is the value that applies at bar i.
  const senkouA = nulls(n);
  const senkouB = nulls(n);
  for (let i = 0; i < n; i++) {
    const src = i - disp;
    if (src < 0) continue;
    if (tenkan[src] != null && kijun[src] != null) senkouA[i] = ((tenkan[src] as number) + (kijun[src] as number)) / 2;
    senkouB[i] = mid(spanB, src);
  }
  // Projected cloud for the next `disp` bars (future values, for charting)
  const futureA: number[] = [];
  const futureB: number[] = [];
  for (let k = n - disp; k < n; k++) {
    if (k < 0) continue;
    if (tenkan[k] != null && kijun[k] != null) futureA.push(((tenkan[k] as number) + (kijun[k] as number)) / 2);
    const b = mid(spanB, k);
    if (b != null) futureB.push(b);
  }
  return { tenkan, kijun, senkouA, senkouB, futureA, futureB };
}

export function supertrend(bars: Bar[], period = 10, mult = 3) {
  const a = atr(bars, period);
  const n = bars.length;
  const line = nulls(n);
  const dir: (1 | -1 | null)[] = new Array(n).fill(null);
  let upper = 0;
  let lower = 0;
  let d: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    if (a[i] == null) continue;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const bu = hl2 + mult * (a[i] as number);
    const bl = hl2 - mult * (a[i] as number);
    const first = line[i - 1] == null;
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    upper = first || bu < upper || pc > upper ? bu : upper;
    lower = first || bl > lower || pc < lower ? bl : lower;
    if (first) d = bars[i].close >= hl2 ? 1 : -1;
    else if (d === 1 && bars[i].close < lower) d = -1;
    else if (d === -1 && bars[i].close > upper) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
  }
  return { line, direction: dir };
}

export function parabolicSar(bars: Bar[], step = 0.02, max = 0.2): Series {
  const n = bars.length;
  const out = nulls(n);
  if (n < 2) return out;
  let up = bars[1].close >= bars[0].close;
  let sar = up ? bars[0].low : bars[0].high;
  let ep = up ? bars[0].high : bars[0].low;
  let af = step;
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, bars[i - 1].low, i > 1 ? bars[i - 2].low : bars[i - 1].low);
      if (bars[i].low < sar) {
        up = false; sar = ep; ep = bars[i].low; af = step;
      } else if (bars[i].high > ep) {
        ep = bars[i].high; af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].high, i > 1 ? bars[i - 2].high : bars[i - 1].high);
      if (bars[i].high > sar) {
        up = true; sar = ep; ep = bars[i].high; af = step;
      } else if (bars[i].low < ep) {
        ep = bars[i].low; af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

/** Classic floor-trader pivots computed from one completed bar (usually the last session). */
export function pivotPoints(bar: Pick<Bar, "high" | "low" | "close">) {
  const { high: h, low: l, close: c } = bar;
  const pp = (h + l + c) / 3;
  return {
    pp,
    r1: 2 * pp - l,
    s1: 2 * pp - h,
    r2: pp + (h - l),
    s2: pp - (h - l),
    r3: h + 2 * (pp - l),
    s3: l - 2 * (h - pp),
  };
}

/** Fibonacci retracements and extensions of a swing. For an up-swing, retracements sit below the high. */
export function fibonacci(swingLow: number, swingHigh: number, trend: "up" | "down") {
  const range = swingHigh - swingLow;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const ext = [1.272, 1.618, 2.0, 2.618];
  if (trend === "up") {
    return {
      retracements: ratios.map((r) => ({ ratio: r, price: swingHigh - range * r })),
      extensions: ext.map((r) => ({ ratio: r, price: swingLow + range * r })),
    };
  }
  return {
    retracements: ratios.map((r) => ({ ratio: r, price: swingLow + range * r })),
    extensions: ext.map((r) => ({ ratio: r, price: swingHigh - range * r })),
  };
}

export const last = <T>(s: (T | null)[]): T | null => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i] as T;
  return null;
};

/** Everything the UI and the AI need, computed once. */
export function computeAll(bars: Bar[]) {
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma100: sma(closes, 100),
    sma200: sma(closes, 200),
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes),
    stochastic: stochastic(bars),
    atr14: atr(bars, 14),
    adx: adx(bars, 14),
    obv: obv(bars),
    vwap: vwap(bars, 20),
    ichimoku: ichimoku(bars),
    supertrend: supertrend(bars),
    psar: parabolicSar(bars),
    volSma20: sma(vols, 20),
  };
}
export type IndicatorSet = ReturnType<typeof computeAll>;
