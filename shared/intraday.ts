// Intraday candles (1, 5, 15, 30 and 60 minutes) from the relay's minute record of ShareSansar's live-trading page.
// Each record line is "HH:MM:SS|SYM:price:volume,..." with only the stocks that changed. A candle's open, high, low
// and close are the recorded last-traded prices inside it, and its volume is the change in the day's volume. Prices
// are sampled about once a minute, so a brief spike between two samples can be missing from these candles (the day's
// own high and low on the daily chart come from the source).
import type { Bar } from "./types.ts";

export type IntradayTf = "1m" | "5m" | "15m" | "30m" | "1h";
export const INTRADAY_MINUTES: Record<IntradayTf, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60 };
export const isIntraday = (tf: string): tf is IntradayTf => tf in INTRADAY_MINUTES;

export interface Tick { sec: number; price: number; volume: number }

/** Seconds since midnight from "HH:MM[:SS]". */
const secs = (t: string) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };

/** The recorded prices of one stock through the day, oldest first. */
export function ticksFor(text: string, symbol: string): Tick[] {
  const out: Tick[] = [];
  const key = `${symbol}:`;
  for (const line of text.split("\n")) {
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const body = line.slice(bar + 1);
    let i = body.startsWith(key) ? 0 : body.indexOf(`,${key}`);
    if (i < 0) continue;
    if (i > 0) i += 1;
    const end = body.indexOf(",", i);
    const [, p, v] = body.slice(i, end < 0 ? undefined : end).split(":");
    const price = Number(p), volume = Number(v);
    if (Number.isFinite(price) && price > 0) out.push({ sec: secs(line.slice(0, bar)), price, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out;
}

/** Candles of `minutes` for the given trading date. Bar.date holds the candle's start as Unix seconds (Nepal clock
 *  time written as UTC, so the chart's axis shows Nepal time). */
export function intradayBars(ticks: Tick[], minutes: number, date: string): Bar[] {
  const day0 = Date.parse(`${date}T00:00:00Z`) / 1000;
  const size = minutes * 60;
  const out: Bar[] = [];
  let lastVol = 0;
  for (const t of ticks) {
    const start = Math.floor(t.sec / size) * size;
    const vol = Math.max(0, t.volume - lastVol);
    lastVol = Math.max(lastVol, t.volume);
    const cur = out[out.length - 1];
    if (!cur || Number(cur.date) !== day0 + start) out.push({ date: String(day0 + start), open: cur ? cur.close : t.price, high: Math.max(t.price, cur ? cur.close : t.price), low: Math.min(t.price, cur ? cur.close : t.price), close: t.price, volume: vol });
    else { cur.high = Math.max(cur.high, t.price); cur.low = Math.min(cur.low, t.price); cur.close = t.price; cur.volume += vol; }
  }
  return out;
}
