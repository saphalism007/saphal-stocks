import { describe, expect, it } from "vitest";
import { moodScore, moodLabel, expectedRange, xirr, BASKETS } from "../shared/discover.ts";

describe("market mood", () => {
  it("scales readings and labels the result", () => {
    const greedy = moodScore({ advancePct: 70, above50Pct: 90, highsPct: 95, momentumPct: 10, turnoverRatio: 1.5, rsi: 80 });
    expect(greedy.score).toBeGreaterThan(85); expect(moodLabel(greedy.score)).toBe("Extreme greed");
    const scared = moodScore({ advancePct: 30, above50Pct: 10, highsPct: 5, momentumPct: -10, turnoverRatio: 0.5, rsi: 20 });
    expect(scared.score).toBeLessThan(15); expect(moodLabel(scared.score)).toBe("Extreme fear");
    expect(moodScore({ advancePct: null, above50Pct: null, highsPct: null, momentumPct: null, turnoverRatio: null, rsi: null }).score).toBe(50);
  });
});
describe("expected range and XIRR", () => {
  it("range widens with time and volatility", () => {
    const closes = Array.from({ length: 61 }, (_, i) => 100 * (1 + (i % 2 ? 0.01 : -0.01)));
    const r = expectedRange(100, closes)!;
    expect(r.month.likely.high - r.month.likely.low).toBeGreaterThan(r.week.likely.high - r.week.likely.low);
    expect(r.week.wide.low).toBeLessThan(r.week.likely.low);
  });
  it("XIRR of +10% in a year is 10%", () => {
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 1100 }])).toBeCloseTo(10, 0);
    expect(xirr([{ date: "2025-01-01", amount: -1000 }])).toBeNull();
  });
  it("baskets have unique keys", () => { expect(new Set(BASKETS.map((b) => b.key)).size).toBe(BASKETS.length); });
});
