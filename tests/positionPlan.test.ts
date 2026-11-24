import { describe, it, expect } from "vitest";
import { positionPlan, reentryPlan, breakevenPrice } from "../shared/positionPlan.ts";
import { sellCost } from "../shared/costs.ts";
import type { Opportunity } from "../shared/opportunities.ts";

const opp = (o: Partial<Opportunity>): Opportunity => ({
  symbol: "ABC", name: "ABC Ltd", sector: "Bank", price: 500, priceDate: "2026-11-17", action: "HOLD", bucket: "hold", headline: "Hold: uptrend intact.", setupType: null, horizon: null, holdingPeriod: null,
  entryLow: null, entryHigh: null, entry: null, stop: null, targets: [], riskReward: null, riskPct: null, buyNow: null, waitFor: null, techReasons: [], fundReasons: [], supports: [480, 450], resistances: [530, 560],
  indicators: { rsi: 55, macd: null, trend: "uptrend", adx: null, sma20: null, sma50: null, sma200: null, maPosition: null, volumeRatio: null, volumeConfirmed: null, obv: null },
  invalidation: [], confidence: 60, confidenceLabel: "Medium", reviewBy: null, avgTurnover: 5e6, fundamentalScore: 65, netAtT1Pct: null, netRiskReward: null, ...o,
});
const fa = { score: 65, valuationScore: 60, redFlags: [], strengths: [], pe: 15, pb: 2, roe: 14, cashYield: 3, yearsPaid5: 5, period: "Q1 2083/84" };
const hold = (wacc: number, qty = 100, date = "2026-06-01") => ({ symbol: "ABC", quantity: qty, wacc, costBasis: wacc * qty, lots: [{ date, qty, costPerShare: wacc }] });

describe("position plan", () => {
  it("break-even covers every selling charge exactly", () => {
    const be = breakevenPrice(100, 50_000)!;
    expect(sellCost(100, be).net).toBeGreaterThanOrEqual(50_000);
    expect(sellCost(100, be - 0.02).net).toBeLessThan(50_000);
  });
  it("in a loss: break-even is the first target and averaging down is cautioned", () => {
    const p = positionPlan({ holding: hold(540), name: "ABC", sector: "Bank", opp: opp({}), price: 500, priceDate: "2026-11-18", live: true, fa, technicalScore: 55, today: "2026-11-19" });
    expect(p.targets[0].basis).toMatch(/Break-even/);
    expect(p.targets[0].price).toBe(p.breakeven);
    expect(p.stop!.price).toBeLessThan(500);
    expect(p.steps.join(" ")).toMatch(/break-even is/);
  });
  it("well in profit: the stop trails at or above break-even", () => {
    const p = positionPlan({ holding: hold(400), name: "ABC", sector: "Bank", opp: opp({}), price: 500, priceDate: "2026-11-18", live: false, fa, technicalScore: 55, today: "2026-11-19" });
    expect(p.stop!.price).toBeGreaterThanOrEqual(p.breakeven!);
    expect(p.pnl).toBeGreaterThan(0);
  });
  it("a SELL signal means sell; a BUY in the zone for a sound business means add", () => {
    expect(positionPlan({ holding: hold(450), name: "ABC", sector: "Bank", opp: opp({ action: "SELL", bucket: "sell", headline: "Breakdown: protect gains." }), price: 500, priceDate: null, live: false, fa, technicalScore: 40, today: "2026-11-19" }).action).toBe("SELL");
    const add = positionPlan({ holding: hold(490), name: "ABC", sector: "Bank", opp: opp({ action: "BUY", bucket: "buy", entryLow: 495, entryHigh: 505, stop: 470, targets: [{ price: 540, basis: "Setup target" }] }), price: 500, priceDate: null, live: false, fa, technicalScore: 70, today: "2026-11-19" });
    expect(add.action).toBe("ADD");
    expect(add.addZone).toMatchObject({ low: 495, high: 505 });
    expect(add.addZone!.example.newWacc).toBeGreaterThan(490);
  });
  it("counts down to long-term tax", () => {
    const p = positionPlan({ holding: hold(450, 100, "2025-12-01"), name: "ABC", sector: "Bank", opp: opp({}), price: 500, priceDate: null, live: false, fa, technicalScore: 50, today: "2026-11-19" });
    expect(p.longTermInDays).toBe(13);
    expect(p.steps.join(" ")).toMatch(/becomes long term/);
  });
  it("sold stocks get a buy-back view, never a plain hold", () => {
    const r = reentryPlan("ABC", "ABC", { date: "2026-10-01", price: 600 }, opp({}), 500);
    expect(r.headline).toMatch(/No buy-back entry now/);
    expect(r.changeSinceSalePct).toBe(-16.67);
  });
});

describe("position plan: strategy, what-if and dates", () => {
  it("a long-term portfolio uses a long-term stop below the 200-day average", () => {
    const o = opp({ stop: 490, indicators: { ...opp({}).indicators, sma200: 440 } });
    const t = positionPlan({ holding: hold(480), name: "ABC", sector: "Bank", opp: o, price: 500, priceDate: "2026-11-18", live: false, fa, technicalScore: 55, today: "2026-11-19", style: "trade" });
    const i = positionPlan({ holding: hold(480), name: "ABC", sector: "Bank", opp: o, price: 500, priceDate: "2026-11-18", live: false, fa, technicalScore: 55, today: "2026-11-19", style: "invest" });
    expect(t.stop!.price).toBe(490);
    expect(i.stop!.price).toBe(426.8);
    expect(i.steps.join(" ")).toMatch(/week closes below/);
  });
  it("shows what you receive today, at the stop and at the first sell zone, after charges and tax", () => {
    const p = positionPlan({ holding: hold(450), name: "ABC", sector: "Bank", opp: opp({}), price: 500, priceDate: "2026-11-18", live: false, fa, technicalScore: 55, today: "2026-11-19" });
    expect(p.scenarios.map((s) => s.label)).toEqual(["Sell everything today", "If the stop is hit", "At the first sell zone"]);
    const now = p.scenarios[0];
    expect(now.receive).toBeLessThan(50_000);
    expect(now.profit).toBeGreaterThan(0);
    expect(p.riskReward!.risk).toBeGreaterThan(0);
  });
  it("lists the book closure with your dividend and the long-term tax date", () => {
    const p = positionPlan({ holding: hold(450, 100, "2026-06-01"), name: "ABC", sector: "Bank", opp: opp({}), price: 500, priceDate: "2026-11-18", live: false, fa, technicalScore: 55, today: "2026-11-19",
      dividend: { fiscalYear: "2082/83", cashPct: 10, bonusPct: 5, bookCloseDate: "2026-12-05" }, faceValue: 100 });
    const bc = p.timing.find((t) => t.label === "Book closure")!;
    expect(bc.detail).toMatch(/Rs. 1,000 cash dividend/);
    expect(bc.detail).toMatch(/5 bonus shares/);
    expect(p.timing.find((t) => t.label === "Long-term tax")!.date).toBe("2027-06-02");
  });
});

describe("position plan: following the recommendation it was bought on", () => {
  const anchor = { label: "Trade signal", date: "2026-11-19", entryLow: 591.5, entryHigh: 594.5, stop: 542.06, t1: 693.8, t2: 742.82, holdDays: null };
  const o = opp({ price: 570, supports: [560, 530], resistances: [600, 640], indicators: { ...opp({}).indicators, sma200: 537 } });
  const base = { holding: hold(593.81, 100, "2026-11-20"), name: "CFCL", sector: "Manufacturing", opp: o, price: 570, priceDate: "2026-11-23", live: false, fa, technicalScore: 55, today: "2026-11-24", style: "invest" as const };
  it("keeps the original stop and targets in a long-term portfolio", () => {
    const p = positionPlan({ ...base, anchor });
    expect(p.follows).toBe("original");
    expect(p.stop!.price).toBe(542.06);
    expect(p.stop!.basis).toMatch(/Original stop/);
    expect(p.targets.map((t) => t.price)).toContain(693.8);
    expect(p.steps.join(" ")).toMatch(/day closes below Rs. 542.06/);
  });
  it("uses the portfolio's long-term stop only when you switch", () => {
    const p = positionPlan({ ...base, anchor, follow: "portfolio" });
    expect(p.follows).toBe("portfolio");
    expect(p.stop!.price).toBe(520.89);
  });
  it("raises the stop to lock in profit but never lowers it", () => {
    const up = positionPlan({ ...base, holding: hold(500, 100, "2026-11-20"), anchor: { ...anchor, stop: 480 }, style: "trade", opp: opp({ price: 570, supports: [560], resistances: [640] }) });
    expect(up.stop!.price).toBeGreaterThan(480);
    expect(up.stop!.basis).toMatch(/raised from the original stop/);
  });
  it("says sell when the original stop is hit, and dates the time stop in trading days", () => {
    const hit = positionPlan({ ...base, price: 540, anchor });
    expect(hit.action).toBe("SELL");
    const sw = positionPlan({ ...base, anchor: { ...anchor, holdDays: 10 } });
    // 10 trading sessions (Sunday to Thursday) after Friday 20 Nov 2026 is Thursday 3 Dec 2026.
    expect(sw.timing.find((t) => t.label === "Sell by")!.date).toBe("2026-12-03");
  });
});
