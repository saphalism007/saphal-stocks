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
