// Candlestick pattern detection on real daily bars. Shapes follow the textbook definitions
// (Nison); trend context is the 5-session close change before the pattern. Pure; tested.
import type { Bar } from "./types.ts";

export interface Candle { index: number; date: string; name: string; dir: "bullish" | "bearish" | "neutral"; bars: number; note: string }

const body = (b: Bar) => Math.abs(b.close - b.open);
const range = (b: Bar) => b.high - b.low;
const upper = (b: Bar) => b.high - Math.max(b.open, b.close);
const lower = (b: Bar) => Math.min(b.open, b.close) - b.low;
const bull = (b: Bar) => b.close > b.open;
const bear = (b: Bar) => b.close < b.open;
const mid = (b: Bar) => (b.open + b.close) / 2;

export function candlesAt(bars: Bar[], i: number): Candle[] {
  const out: Candle[] = [];
  const b = bars[i], p = bars[i - 1], q = bars[i - 2];
  if (!b || !p || range(b) <= 0) return out;
  // Average body of the prior 10 sessions decides what counts as "long" or "small".
  const prior = bars.slice(Math.max(0, i - 10), i);
  const avgBody = prior.reduce((t, x) => t + body(x), 0) / Math.max(1, prior.length) || range(b) * 0.5;
  const ref = bars[i - 6] ?? bars[0];
  const down = p.close < ref.close * 0.98, up = p.close > ref.close * 1.02;
  const add = (name: string, dir: Candle["dir"], n: number, note: string) => out.push({ index: i, date: b.date, name, dir, bars: n, note });
  const r = range(b), bd = body(b);

  if (bd <= r * 0.1) {
    if (lower(b) >= r * 0.6) add("Dragonfly doji", down ? "bullish" : "neutral", 1, "Open and close at the high after sellers pushed it down: buyers rejected lower prices.");
    else if (upper(b) >= r * 0.6) add("Gravestone doji", up ? "bearish" : "neutral", 1, "Open and close at the low after buyers pushed it up: sellers rejected higher prices.");
    else add("Doji", "neutral", 1, "Open about close: indecision. Matters most after a strong move.");
  } else if (bd >= r * 0.9) add(bull(b) ? "Bullish marubozu" : "Bearish marubozu", bull(b) ? "bullish" : "bearish", 1, bull(b) ? "Closed at the high with no shadows: buyers controlled the whole session." : "Closed at the low with no shadows: sellers controlled the whole session.");
  else if (bd <= r * 0.3 && upper(b) > bd && lower(b) > bd) add("Spinning top", "neutral", 1, "Small body, shadows both sides: tug of war, momentum fading.");
  if (bd > r * 0.1 && lower(b) >= 2 * bd && upper(b) <= Math.max(bd * 0.5, r * 0.1)) {
    if (down) add("Hammer", "bullish", 1, "Long lower shadow after a fall: sellers were pushed back by buyers.");
    else if (up) add("Hanging man", "bearish", 1, "Hammer shape after a rise: selling appeared during the session.");
  }
  if (bd > r * 0.1 && upper(b) >= 2 * bd && lower(b) <= Math.max(bd * 0.5, r * 0.1)) {
    if (down) add("Inverted hammer", "bullish", 1, "Long upper shadow after a fall: buyers tested higher; needs a strong next session.");
    else if (up) add("Shooting star", "bearish", 1, "Long upper shadow after a rise: buyers were rejected at the high.");
  }
  // Two-bar patterns
  if (bear(p) && bull(b) && b.close >= p.open && b.open <= p.close && bd > body(p)) add("Bullish engulfing", down ? "bullish" : "neutral", 2, "Today's up body swallowed yesterday's down body: buyers took over.");
  if (bull(p) && bear(b) && b.open >= p.close && b.close <= p.open && bd > body(p)) add("Bearish engulfing", up ? "bearish" : "neutral", 2, "Today's down body swallowed yesterday's up body: sellers took over.");
  if (bear(p) && body(p) >= avgBody && bd < body(p) * 0.5 && Math.max(b.open, b.close) <= p.open && Math.min(b.open, b.close) >= p.close) add(bull(b) ? "Bullish harami" : "Harami", down ? "bullish" : "neutral", 2, "Small body inside yesterday's long down body: selling is losing force.");
  if (bull(p) && body(p) >= avgBody && bd < body(p) * 0.5 && Math.max(b.open, b.close) <= p.close && Math.min(b.open, b.close) >= p.open) add(bear(b) ? "Bearish harami" : "Harami", up ? "bearish" : "neutral", 2, "Small body inside yesterday's long up body: buying is losing force.");
  if (bear(p) && body(p) >= avgBody && bull(b) && b.open <= p.close && b.close > mid(p) && b.close < p.open) add("Piercing line", down ? "bullish" : "neutral", 2, "Opened at or below yesterday's close and closed above the middle of its body.");
  if (bull(p) && body(p) >= avgBody && bear(b) && b.open >= p.close && b.close < mid(p) && b.close > p.open) add("Dark cloud cover", up ? "bearish" : "neutral", 2, "Opened at or above yesterday's close and closed below the middle of its body.");
  const tol = r * 0.05 + b.close * 0.002;
  if (down && Math.abs(b.low - p.low) <= tol && bear(p) && bull(b)) add("Tweezer bottom", "bullish", 2, "Two sessions with the same low: a floor where buyers stepped in twice.");
  if (up && Math.abs(b.high - p.high) <= tol && bull(p) && bear(b)) add("Tweezer top", "bearish", 2, "Two sessions with the same high: a ceiling where sellers stepped in twice.");
  // Three-bar patterns
  if (q) {
    const refQ = bars[i - 7] ?? bars[0];
    const downQ = q.close < refQ.close * 0.98 || bear(q), upQ = q.close > refQ.close * 1.02 || bull(q);
    if (downQ && bear(q) && body(q) >= avgBody && body(p) <= body(q) * 0.4 && bull(b) && b.close > mid(q)) add("Morning star", "bullish", 3, "Long down day, small pause, then a strong up day: a classic bottom reversal.");
    if (upQ && bull(q) && body(q) >= avgBody && body(p) <= body(q) * 0.4 && bear(b) && b.close < mid(q)) add("Evening star", "bearish", 3, "Long up day, small pause, then a strong down day: a classic top reversal.");
    const soldier = (x: Bar, prev: Bar) => bull(x) && x.close > prev.close && x.open >= Math.min(prev.open, prev.close) && x.open <= Math.max(prev.open, prev.close) && upper(x) <= body(x) * 0.4 && body(x) >= avgBody * 0.6;
    const crow = (x: Bar, prev: Bar) => bear(x) && x.close < prev.close && x.open >= Math.min(prev.open, prev.close) && x.open <= Math.max(prev.open, prev.close) && lower(x) <= body(x) * 0.4 && body(x) >= avgBody * 0.6;
    if (bull(q) && soldier(p, q) && soldier(b, p)) add("Three white soldiers", "bullish", 3, "Three strong up days, each closing higher: steady buying.");
    if (bear(q) && crow(p, q) && crow(b, p)) add("Three black crows", "bearish", 3, "Three strong down days, each closing lower: steady selling.");
  }
  return out;
}

/** Patterns over the last `lookback` sessions (most recent first). */
export function recentCandles(bars: Bar[], lookback = 5): Candle[] {
  const out: Candle[] = [];
  for (let i = bars.length - 1; i >= Math.max(2, bars.length - lookback); i--) out.push(...candlesAt(bars, i));
  return out;
}

/** All directional patterns over the history (for chart markers). */
export function allCandles(bars: Bar[], from = 0): Candle[] {
  const out: Candle[] = [];
  for (let i = Math.max(2, from); i < bars.length; i++) for (const c of candlesAt(bars, i)) if (c.dir !== "neutral") out.push(c);
  return out;
}
