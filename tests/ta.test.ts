import { describe, expect, it } from "vitest";
import { INDICATORS, defaults, wmaS, emaS, smaS, williamsR, mfi, cmf, adLine, aroon, zigzag, monthlyPivots, hma, cci, histVol, vwapRolling } from "../shared/ta.ts";
import { candlesAt } from "../shared/candles.ts";
import { analyzeChart, answerChart, divergences } from "../shared/analyst.ts";
import { evaluate } from "../shared/opportunities.ts";
import type { Bar } from "../shared/types.ts";

// Deterministic synthetic history: trend + cycle, no randomness.
function series(n: number, drift = 0.2): Bar[] {
  const out: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(5, p + drift + Math.sin(i / 6) * 2);
    const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, open: o, high: Math.max(o, p) + 1, low: Math.min(o, p) - 1, close: p, volume: 1000 + (i % 7) * 200 });
  }
  return out;
}

describe("indicator helpers", () => {
  it("WMA weights the latest value most", () => { expect(wmaS([1, 2, 3], 3)[2]).toBeCloseTo((1 + 4 + 9) / 6); });
  it("EMA seeds with the SMA and skips leading nulls", () => {
    const e = emaS([null, 2, 4, 6, 8], 2);
    expect(e[1]).toBeNull(); expect(e[2]).toBe(3); expect(e[3]).toBeCloseTo(6 * (2 / 3) + 3 / 3);
  });
  it("SMA over nulls stays null until a full window", () => { expect(smaS([null, 1, 2, 3], 2)).toEqual([null, null, 1.5, 2.5]); });
  it("HMA has the right warm-up", () => { const h = hma(series(60).map((b) => b.close), 16); expect(h[15 + 3 - 1]).toBeNull(); expect(h[16 + 4 - 2]).not.toBeNull(); });
});

describe("bounded oscillators", () => {
  const b = series(300);
  it("Williams %R stays in [-100, 0]", () => { for (const v of williamsR(b, 14)) if (v != null) { expect(v).toBeLessThanOrEqual(0); expect(v).toBeGreaterThanOrEqual(-100); } });
  it("MFI stays in [0, 100]", () => { for (const v of mfi(b, 14)) if (v != null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); } });
  it("CMF stays in [-1, 1]", () => { for (const v of cmf(b, 20)) if (v != null) expect(Math.abs(v)).toBeLessThanOrEqual(1); });
  it("Aroon up is 100 on a fresh high", () => { const up = series(40, 1).map((x, i) => ({ ...x, high: 100 + i, low: 90 + i })); expect(aroon(up, 14).up[39]).toBe(100); });
});

describe("volume and price formulas", () => {
  it("A/D adds full volume on a close at the high", () => { expect(adLine([{ date: "a", open: 1, high: 2, low: 1, close: 2, volume: 10 }])[0]).toBe(10); });
  it("CCI is 0 for a flat series", () => { const flat = Array.from({ length: 30 }, (_, i) => ({ date: String(i), open: 5, high: 5, low: 5, close: 5, volume: 1 })); expect(cci(flat, 20)[29]).toBe(0); });
  it("rolling VWAP uses exchange turnover when present", () => { const b = [{ date: "a", open: 1, high: 1, low: 1, close: 1, volume: 10, amount: 200 }, { date: "b", open: 1, high: 1, low: 1, close: 1, volume: 10, amount: 400 }]; expect(vwapRolling(b, 2)[1]).toBe(30); });
  it("historical volatility is 0 for constant growth", () => { const c = Array.from({ length: 30 }, (_, i) => 100 * 1.01 ** i); expect(histVol(c, 20)[29]).toBeCloseTo(0, 6); });
  it("monthly pivots use the previous month", () => {
    const b: Bar[] = [{ date: "2024-01-30", open: 10, high: 12, low: 8, close: 10, volume: 1 }, { date: "2024-02-01", open: 10, high: 11, low: 9, close: 10, volume: 1 }];
    const p = monthlyPivots(b); expect(p.p[0]).toBeNull(); expect(p.p[1]).toBe(10); expect(p.r1[1]).toBe(12); expect(p.s1[1]).toBe(8);
  });
  it("zigzag marks alternating swing points", () => { const z = zigzag(series(200), 3).filter((v) => v != null); expect(z.length).toBeGreaterThan(4); });
});

describe("registry", () => {
  it("every indicator computes aligned outputs without throwing", () => {
    const b = series(400);
    expect(INDICATORS.length).toBeGreaterThanOrEqual(55);
    for (const d of INDICATORS.filter((x) => x.id !== "turnover")) {
      const out = d.compute(b, defaults(d));
      for (const o of d.outputs) { expect(out[o.key], `${d.id}.${o.key}`).toBeDefined(); expect(out[o.key].length).toBe(b.length); expect(out[o.key].some((v) => v != null && Number.isFinite(v)), `${d.id}.${o.key} has values`).toBe(true); }
    }
  });
});

describe("candlesticks", () => {
  const down: Bar[] = Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, open: 110 - i * 2, high: 111 - i * 2, low: 107 - i * 2, close: 108 - i * 2, volume: 1 }));
  it("finds a hammer after a fall", () => { const b = [...down, { date: "h", open: 88, high: 90.5, low: 82, close: 90.3, volume: 1 }]; expect(candlesAt(b, b.length - 1).map((c) => c.name)).toContain("Hammer"); });
  it("finds a bullish engulfing after a fall", () => { const b = [...down, { date: "e", open: 87, high: 93, low: 86.5, close: 92, volume: 1 }]; expect(candlesAt(b, b.length - 1).map((c) => c.name)).toContain("Bullish engulfing"); });
});

describe("chart analyst", () => {
  const b = series(400, 0.3);
  const opp = evaluate({ symbol: "TEST", name: "Test", sector: "Banks", bars: b, fundamentals: null, avgTurnover20: 5_000_000, latestMarketDate: b[b.length - 1].date });
  const a = analyzeChart({ symbol: "TEST", name: "Test", sector: "Banks", bars: b, opp, fund: null, avgTurnover20: 5_000_000 });
  it("gives a verdict, evidence with numbers, levels and five strategies", () => {
    expect(["STRONG BUY", "BUY", "WAIT", "HOLD", "SELL", "STRONG SELL"]).toContain(a.verdict);
    expect(a.reasons.find((r) => r.topic === "RSI (14)")?.text).toMatch(/RSI \d/);
    expect(a.strategies.map((s) => s.key)).toEqual(["intraday", "short", "swing", "positional", "long"]);
    expect(a.strategies[0].available).toBe(false);
    expect(a.assessments.long.label).toBe("Not enough data");
  });
  it("answers chart questions from the analysis", () => {
    expect(answerChart("Where should I put my stop-loss?", a)).toMatch(/stop/i);
    expect(answerChart("Explain this chart like I am a beginner", a)).toMatch(/plain words/);
    expect(answerChart("Is this suitable for long-term investment?", a)).toMatch(/Long-term/);
  });
  it("refuses to signal on short history", () => {
    const s = series(40);
    const o = evaluate({ symbol: "X", name: "X", sector: "", bars: s, fundamentals: null, avgTurnover20: 5e6, latestMarketDate: s[39].date });
    expect(analyzeChart({ symbol: "X", name: "X", sector: "", bars: s, opp: o, fund: null }).verdict).toBe("NO SIGNAL");
  });
  it("divergence detector returns well-formed items", () => { for (const d of divergences(b)) expect(["bullish", "bearish"]).toContain(d.dir); });
});
