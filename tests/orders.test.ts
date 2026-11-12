import { describe, expect, it } from "vitest";
import { nextSession, sessionLabel, tradeOrders, tradingWeekdays, type ChartAnalysis } from "../shared/analyst.ts";

const base = (over: Partial<ChartAnalysis>): ChartAnalysis => ({
  symbol: "ABC", name: "ABC", sector: "x", asOf: "2026-11-06", price: 505, changePct: 0, verdict: "WAIT", tone: "neutral", headline: "No clean setup.", confidence: 50, confidenceLabel: "",
  plan: { entryLow: null, entryHigh: null, bestZone: { low: 497, high: 501 }, breakout: { price: 526.27, why: "" }, stop: 480, stopWhy: null, targets: [{ price: 515, basis: "Resistance", pct: 2 }], riskReward: null, netRiskReward: null, riskPct: null, holding: null, buyNow: null, waitFor: null, reviewBy: "2026-11-13", expiry: "" },
  reasons: [], risks: [], invalidation: [], levels: [], zones: [], strategies: [], assessments: {} as never, events: [], candles: [], patterns: [], divergences: [], structure: {} as never, indicators: {}, scores: { technical: null, fundamental: null }, tags: [], tagNotes: {}, history: null, setupHistory: null, dataNotes: [],
  ...over,
} as ChartAnalysis);

describe("exact trade orders", () => {
  it("next NEPSE session skips Friday and Saturday", () => {
    expect(nextSession("2026-10-29")).toBe("2026-11-01"); // Thursday -> Sunday
    expect(nextSession("2026-11-01")).toBe("2026-11-02");
    expect(nextSession("2026-11-05")).toBe("2026-11-15"); // Tihar closure 8 to 12 Nov is skipped
    expect(sessionLabel("2026-11-08")).toMatch(/^Sunday 2026-11-08, 11:00 AM/);
  });
  it("follows a Monday-to-Friday week when the data shows one", () => {
    const dates: string[] = []; for (let d = Date.parse("2026-09-01"); d < Date.parse("2026-11-07"); d += 86_400_000) { const x = new Date(d); if (x.getUTCDay() >= 1 && x.getUTCDay() <= 5) dates.push(x.toISOString().slice(0, 10)); }
    const days = tradingWeekdays(dates);
    expect(days).toEqual([1, 2, 3, 4, 5]);
    expect(nextSession("2026-10-30", days)).toBe("2026-11-02");
    expect(nextSession("2026-11-06", days)).toBe("2026-11-13"); // reopens Friday after Tihar // Friday -> Monday
  });
  it("WAIT gives don't-buy-now plus dip and breakout conditions with prices", () => {
    const o = tradeOrders(base({}), 497, 515)!;
    expect(o.summary).toMatch(/don't buy ABC at Rs. 505/);
    expect(o.forBuyers.map((x) => x.kind)).toEqual(["wait", "buy", "buy"]);
    expect(o.forBuyers[1].title).toContain("497");
    expect(o.forBuyers[2].title).toContain("526.27");
    expect(o.forHolders.some((x) => x.kind === "stop" && x.price === 480)).toBe(true);
  });
  it("BUY gives a buy range, sells at targets and a stop-loss", () => {
    const o = tradeOrders(base({ verdict: "BUY", plan: { ...base({}).plan, entryLow: 500, entryHigh: 506, targets: [{ price: 530, basis: "R1", pct: 5 }, { price: 560, basis: "R2", pct: 10 }] } }), 497, 530)!;
    expect(o.summary).toMatch(/buy ABC between Rs. 500 and Rs. 506 on Sunday 2026-11-15/);
    expect(o.forBuyers.map((x) => x.kind)).toEqual(["buy", "sell", "sell", "stop", "wait"]);
  });
  it("SELL tells holders where to sell and buyers not to buy", () => {
    const o = tradeOrders(base({ verdict: "SELL" }), 497, 515)!;
    expect(o.forBuyers[0].kind).toBe("avoid");
    expect(o.forHolders[0].title).toMatch(/SELL at Rs. 505/);
  });
});
