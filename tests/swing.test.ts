import { describe, it, expect } from "vitest";
import { swingSeries, swingAt, simulate, stats, SWING_THRESHOLD } from "../shared/swing.ts";
import type { Bar } from "../shared/types.ts";

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
// A steady uptrend with rising volume and strong closes, ending at a fresh 20-session high.
function uptrend(n = 120, extra: (i: number, b: Bar) => Bar = (_, b) => b): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = 300 * (1 + 0.004 * i) + (i % 2 === 0 ? -3 : 3) + (i === n - 1 ? 6 : 0);
    const vol = i > n - 6 ? 60_000 : 30_000;
    out.push(extra(i, { date: day(i), open: c - 1, high: c + 1, low: c - 3, close: c + 0.5, volume: vol, amount: (c + 0.5) * vol }));
  }
  return out;
}

describe("1-2 week swing rules", () => {
  it("scores a healthy breakout high and builds a sensible plan", () => {
    const b = uptrend();
    const s = swingAt(swingSeries(b), b.length - 1)!;
    expect(s).not.toBeNull();
    expect(s.score).toBeGreaterThanOrEqual(SWING_THRESHOLD);
    expect(s.setup).toBe("Breakout");
    const p = b[b.length - 1].close;
    expect(s.plan.stop).toBeLessThan(p);
    expect(s.plan.riskPct).toBeLessThanOrEqual(8);
    expect(s.plan.t1).toBeGreaterThan(p);
    expect(s.plan.t2).toBeGreaterThan(s.plan.t1);
  });
  it("rejects illiquid stocks and pumps", () => {
    const thin = uptrend(120, (_, x) => ({ ...x, volume: 1000, amount: x.close * 1000 }));
    expect(swingAt(swingSeries(thin), thin.length - 1)).toBeNull();
    const pump = uptrend(120, (i, x) => (i >= 110 ? { ...x, close: x.close * Math.pow(1.1, i - 109), high: x.close * Math.pow(1.1, i - 109) * 1.01 } : x));
    expect(swingAt(swingSeries(pump), pump.length - 1)).toBeNull();
  });
  it("replays a trade: half at target 1, stop moved to entry, after all costs", () => {
    const b = uptrend(100);
    const S = swingSeries(b);
    const sig = { score: 80, reasons: [], setup: "Breakout" as const, plan: { entryLow: 400, entryHigh: 420, stop: 380, t1: 430, t2: 460, riskPct: 5, exitBy: 10 } };
    const i = 90;
    // Next open 410, then target 1 hit, then price falls back to entry: second half exits at the entry (stop moved up).
    b[i + 1] = { ...b[i + 1], open: 410, high: 415, low: 405, close: 412 };
    b[i + 2] = { ...b[i + 2], open: 420, high: 432, low: 418, close: 428 };
    b[i + 3] = { ...b[i + 3], open: 415, high: 416, low: 405, close: 406 };
    const t = simulate(S, i, sig)!;
    expect(t.entry).toBe(410);
    expect(t.outcome).toBe("target");
    expect(t.netPct).toBeGreaterThan(0);
    expect(t.netPct).toBeLessThan(2.5); // charges and tax reduce the gross 2.4% on half
  });
  it("skips a trade that opens above the buy range, and records stop losses", () => {
    const b = uptrend(100);
    const S = swingSeries(b);
    const plan = { entryLow: 400, entryHigh: 420, stop: 380, t1: 430, t2: 460, riskPct: 5, exitBy: 10 };
    b[91] = { ...b[91], open: 440 };
    expect(simulate(S, 90, { score: 80, reasons: [], setup: "Breakout", plan })).toBeNull();
    b[91] = { ...b[91], open: 410, high: 411, low: 370, close: 375 };
    const t = simulate(S, 90, { score: 80, reasons: [], setup: "Breakout", plan })!;
    expect(t.outcome).toBe("stop");
    expect(t.netPct).toBeLessThan(-7);
    expect(stats([{ ...t, symbol: "X", marketDown: false }]).stopPct).toBe(100);
  });
});
