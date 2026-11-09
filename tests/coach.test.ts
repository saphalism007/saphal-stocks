import { describe, expect, it } from "vitest";
import { habitReport, preTrade, holdingAction } from "../shared/coach.ts";

describe("habit report", () => {
  const T = (date: string, exitDate: string, entry: number, exit: number, stop = entry * 0.95, target = entry * 1.1, emotion = "calm") => ({ date, exitDate, symbol: "X" + date, entry, exit, stop, target, qty: 10, emotion, followedPlan: true });
  it("spots holding losers longer and losses past the stop", () => {
    const r = habitReport([T("2026-01-01", "2026-01-05", 100, 108), T("2026-02-01", "2026-03-20", 100, 80), T("2026-04-01", "2026-05-25", 100, 85), T("2026-06-01", "2026-06-04", 100, 104)]);
    expect(r.closed).toBe(4);
    expect(r.winRatePct).toBe(50);
    expect(r.insights.some((i) => /hold losers longer/.test(i.title))).toBe(true);
    expect(r.insights.some((i) => /past your stop/.test(i.title))).toBe(true);
  });
  it("asks for more trades when there are few", () => { expect(habitReport([]).insights[0].title).toMatch(/Log more/); });
});

describe("pre-buy checklist", () => {
  it("sizes the position from the risk and flags a weak trade", () => {
    const r = preTrade({ price: 500, entryHigh: 505, stop: 480, target: 560, verdict: "BUY", capital: 100000, riskPct: 1, avgTurnover: 5e6, sectorWeightAfterPct: 20, daysToBookClose: null, openPositions: 1 });
    expect(r.qty).toBe(50); // Rs 1,000 risk / Rs 20 per share
    expect(r.go).toBe("GO");
    const bad = preTrade({ price: 500, entryHigh: 450, stop: null, target: null, verdict: "SELL", capital: 100000, riskPct: 5, avgTurnover: 2e5, sectorWeightAfterPct: 60, daysToBookClose: 2, openPositions: 12 });
    expect(bad.go).toBe("DON'T BUY");
  });
});

describe("holding action", () => {
  const base = { symbol: "A", price: 100, wacc: 90, weightPct: 10, unrealizedPct: 11, verdict: "HOLD", stop: 92, t1: 120, buyZoneHigh: null, qty: 100 };
  it("sell when below stop, trim when too big, hold otherwise", () => {
    expect(holdingAction({ ...base, price: 90 }).level).toBe("urgent");
    expect(holdingAction({ ...base, weightPct: 40 }).action).toMatch(/Trim/);
    expect(holdingAction(base).action).toBe("Hold");
  });
});
