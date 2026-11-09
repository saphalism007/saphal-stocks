import { describe, expect, it } from "vitest";
import { buildPlan, channelMix } from "../shared/money.ts";

const rates = { fdPct: 8, savingPct: 3, tbillPct: 4, inflationPct: 5, equityLongRunPct: 12, interestTaxPct: 6 };
const base = { risk: "medium" as const, horizonYears: 5, emergencyGap: 0, expensiveDebt: [], nearTermNeeds: [], rates };

describe("flexible plan", () => {
  it("works with nothing today and a monthly amount", () => {
    const p = buildPlan({ ...base, lumpSum: 0, monthly: [20000] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.totalIn).toBe(20000 * 60);
    expect(p.yearly).toHaveLength(5);
    expect(p.yearly[4].mid).toBeGreaterThan(p.totalIn);
    expect(p.yearly[4].low).toBeLessThanOrEqual(p.yearly[4].mid);
  });
  it("refuses an empty plan with a reason", () => {
    const p = buildPlan({ ...base, lumpSum: 0, monthly: [] });
    expect(p.ok).toBe(false);
  });
  it("handles months that vary, including zero months", () => {
    const pat = [5000, 0, 30000, 0, 0, 10000, 0, 0, 0, 0, 0, 15000];
    const p = buildPlan({ ...base, lumpSum: 0, monthly: pat, horizonYears: 2 });
    if (!p.ok) throw new Error();
    expect(p.totalIn).toBe(2 * 60000);
    expect(p.avgMonthly).toBe(5000);
  });
  it("fills the emergency fund before investing", () => {
    const p = buildPlan({ ...base, lumpSum: 0, monthly: [10000], emergencyGap: 30000 });
    if (!p.ok) throw new Error();
    expect(p.priorities[0].done).toBe(true);
    expect(p.priorities[0].monthDone).toBe(3);
  });
  it("diversifies across several channels and percentages add to 100", () => {
    const { mix } = channelMix("medium", 7, rates);
    expect(mix.length).toBeGreaterThanOrEqual(5);
    expect(Math.round(mix.reduce((s, c) => s + c.pct, 0))).toBe(100);
    expect(channelMix("low", 1, rates).mix.every((c) => c.key !== "stocks" || c.pct < 10)).toBe(true);
  });
  it("step-up raises later contributions", () => {
    const a = buildPlan({ ...base, lumpSum: 0, monthly: [10000] }), b = buildPlan({ ...base, lumpSum: 0, monthly: [10000], stepUpPct: 10 });
    if (!a.ok || !b.ok) throw new Error();
    expect(b.totalIn).toBeGreaterThan(a.totalIn);
  });
});
