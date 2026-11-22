import { describe, it, expect } from "vitest";
import { research, type ResearchInput } from "../shared/research.ts";
import type { Opportunity } from "../shared/opportunities.ts";
import type { FundamentalAnalysis } from "../shared/fundamentals.ts";

const opp = (o: Partial<ResearchInput["opp"]> = {}): ResearchInput["opp"] => ({
  symbol: "ABC", name: "ABC", sector: "Commercial Bank", price: 500, priceDate: "2026-11-20", action: "BUY", bucket: "buy", headline: "Pullback: in the entry zone.", setupType: "Pullback to support", horizon: "swing", holdingPeriod: "1-4 weeks",
  entryLow: 495, entryHigh: 505, entry: 500, stop: 480, targets: [{ price: 540, basis: "Setup target" }, { price: 560, basis: "Next resistance level" }], riskReward: 2, riskPct: 4, buyNow: "now", waitFor: null,
  techReasons: ["Bounce from support on volume."], fundReasons: [], supports: [480, 460], resistances: [540, 560],
  indicators: { rsi: 55, macd: "bullish cross", trend: "uptrend", adx: 25, sma20: 495, sma50: 490, sma200: 450, maPosition: "Above 50 > 200 (bullish stack)", volumeRatio: 1.6, volumeConfirmed: true, obv: "rising" },
  invalidation: ["A daily close below Rs. 480."], confidence: 75, confidenceLabel: "High", reviewBy: "2026-11-27", avgTurnover: 5e6, fundamentalScore: 70, netAtT1Pct: 6, netRiskReward: 1.8, history: { trades: 30, winRatePct: 55, avgNetPct: 1.2 }, ...o,
});
const fa = (score: number, redFlags: string[] = [], yoy = 15): FundamentalAnalysis => ({
  symbol: "ABC", sector: "Commercial Bank", sectorGroup: "bank" as never, latestPeriod: "1st Quarter 2083/2084", periods: [], metrics: [], byKey: { pe: 15, pb: 1.8, roe: 14 },
  growth: [{ label: "Net profit YoY (Q1 vs Q1)", value: yoy, basis: "" }], dividend: { latestYear: null, cashPct: null, bonusPct: null, cashYieldPct: null, yearsPaidLast5: 5, history: [] },
  score: { overall: score, components: [{ name: "Valuation", weight: 0.2, score: 60, parts: [] }] } as never, redFlags, strengths: ["Good capital"], dataNotes: [],
});
const base = (o: Partial<ResearchInput> = {}): ResearchInput => ({
  symbol: "ABC", name: "ABC", sector: "Commercial Bank", opp: opp(), fa: fa(70), faIn: null, indicators: { bull: 70, bear: 15, neutral: 15 },
  news: [{ date: "2026-11-10", title: "ABC Bank has proposed 15% cash dividend for fiscal year 2082/83", category: "Dividend / bonus", url: "u1" }],
  dividends: [], audit: { fiscalYear: "2081/82", published: "2026-01-10", url: "a1" },
  market: { mood: 60, nepse: { close: 2700, sma50: 2650, sma200: 2600 } }, sectorIndex: { name: "Banking SubIndex", close: 1600, sma50: 1550, sma200: 1500, ret20: 3 }, today: "2026-11-21", ...o,
});

describe("research verdict", () => {
  it("gives STRONG BUY only when every area agrees", () => {
    const r = research(base());
    expect(r.decision).toBe("STRONG BUY");
    expect(r.agree.positive).toBeGreaterThanOrEqual(4);
    expect(r.plan.entry).toMatch(/Buy between Rs. 495 and Rs. 505/);
    expect(r.plan.stop).toMatch(/Rs. 480/);
  });
  it("downgrades a chart BUY when the business is weak", () => {
    const r = research(base({ fa: fa(30, ["NPL 6%", "Low capital", "Loss"]) }));
    expect(r.decision).toBe("WATCH");
    expect(r.whyNot.join(" ")).toMatch(/business is weak/);
  });
  it("downgrades a chart BUY on negative news", () => {
    const r = research(base({ news: [{ date: "2026-11-15", title: "NRB imposes penalty on ABC Bank", category: "News", url: null }] }));
    expect(r.decision).toBe("WATCH");
    expect(r.pillars.find((p) => p.key === "news")!.verdict).toBe("negative");
  });
  it("does not call a setup with a losing track record a buy", () => {
    const r = research(base({ opp: opp({ history: { trades: 20, winRatePct: 35, avgNetPct: -2.3 } }) }));
    expect(r.decision).toBe("WATCH");
    expect(r.whyNot.join(" ")).toMatch(/poor record/);
  });
  it("turns a chart SELL into REDUCE for a sound business, SELL otherwise", () => {
    expect(research(base({ opp: opp({ action: "SELL", bucket: "sell" }) })).decision).toBe("REDUCE");
    expect(research(base({ opp: opp({ action: "SELL", bucket: "sell" }), fa: fa(30, ["a", "b", "c"]) })).decision).toBe("SELL");
  });
  it("flags a right share issue and an upcoming book closure", () => {
    const r = research(base({ news: [{ date: "2026-11-12", title: "ABC to issue 1:1 right share", category: "Right share", url: null }], dividends: [{ fiscalYear: "2082/83", cashPct: 10, bonusPct: 5, bookCloseDate: "2026-12-01" }] }));
    const n = r.pillars.find((p) => p.key === "news")!;
    expect(n.reasons.join(" ")).toMatch(/Dilution/);
    expect(n.reasons.join(" ")).toMatch(/Book closure on 2026-12-01/);
  });
  it("never shows impossible valuation figures", () => {
    const f = fa(80); f.byKey = { pe: 0.02, pb: 0, roe: 9 };
    const r = research(base({ fa: f }));
    const b = r.pillars.find((p) => p.key === "business")!;
    expect(b.reasons[0]).toMatch(/inconsistent/);
    expect(b.verdict).not.toBe("positive");
  });
});

describe("research with smart money and the economy", () => {
  const sm = (o: Record<string, unknown> = {}) => ({ phase: "Markup", phaseWhy: "x", risk: "Low", riskWhy: [], brokerRead: "Accumulation", sessions: 6, metrics: {} as never, topBuyers: [], topSellers: [], verdict: "positive", score: 70, summary: "s", reasons: ["r"], blocksBuy: null, ...o }) as never;
  it("blocks a buy when there are signs of operator activity", () => {
    const r = research(base({ smart: sm({ risk: "High", verdict: "negative", blocksBuy: "Signs of operator activity." }) }));
    expect(r.decision).toBe("WATCH");
    expect(r.whyNot.join(" ")).toMatch(/operator/);
  });
  it("does not accumulate while big brokers distribute", () => {
    const r = research(base({ opp: opp({ action: "HOLD", bucket: "hold" as never }), smart: sm({ brokerRead: "Distribution", verdict: "neutral" }) }));
    expect(r.decision).toBe("HOLD");
    expect(r.headline).toMatch(/net sellers/);
  });
  it("still gives a strong buy when smart money and the economy agree", () => {
    const r = research(base({ smart: sm(), macro: { verdict: "positive", score: 80, summary: "ok", points: [], news: [], newsTone: { positive: 1, negative: 0 }, calendar: [], asOf: null, source: null, sectorNotes: {} } }));
    expect(r.decision).toBe("STRONG BUY");
    expect(r.pillars.map((p) => p.key)).toEqual(["chart", "indicators", "business", "reports", "news", "market", "smart", "macro"]);
  });
});
