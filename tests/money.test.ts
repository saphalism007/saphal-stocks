import { describe, expect, it } from "vitest";
import { summarize, savingsAdvice, adviseAllocation, equityCap, loanVsInvest, compareDeposits, debentureYield, futureMonthly, cagr, EMPTY_MONEY, type MoneyData, type MarketRates } from "../shared/money.ts";
import { parseNrbRates, parseMacroText } from "../server/ingest/providers.ts";

const rates: MarketRates = { fdPct: 6, savingPct: 3, tbillPct: 1.1, inflationPct: 6.34, equityLongRunPct: 9, interestTaxPct: 6 };
const me: MoneyData = {
  ...EMPTY_MONEY,
  income: [{ id: "1", label: "Salary", amount: 150_000 }],
  expenses: [
    { id: "a", label: "Rent", amount: 50_000, category: "housing", essential: true },
    { id: "b", label: "Food", amount: 20_000, category: "food", essential: true },
    { id: "c", label: "Restaurants", amount: 20_000, category: "dining", essential: false },
  ],
  accounts: [
    { id: "s", name: "Savings", type: "bank", balance: 1_200_000 },
    { id: "f", name: "FD", type: "fd", balance: 500_000, ratePct: 6 },
    { id: "x", name: "Shares", type: "stocks", balance: 300_000 },
  ],
  liabilities: [{ id: "cc", name: "Credit card", type: "credit_card", balance: 100_000, ratePct: 18, emi: 10_000 }],
  risk: "medium", horizonYears: 7, emergencyMonths: 6,
};

describe("money summary", () => {
  const s = summarize(me);
  it("computes cash flow, savings rate and net worth", () => {
    expect(s.cashFlow).toBe(150_000 - 90_000 - 10_000);
    expect(s.savingsRatePct).toBe(33.3);
    expect(s.netWorth).toBe(2_000_000 - 100_000);
    expect(s.debtServicePct).toBe(6.7);
  });
  it("sizes the emergency fund from essential costs plus EMIs", () => {
    expect(s.emergencyTarget).toBe(70_000 * 6 + 10_000 * 3);
    expect(s.emergencyGap).toBe(0);
    expect(s.idleCash).toBe(Math.round(1_200_000 - 450_000 * 1.15));
  });
  it("splits guaranteed, cash and market money", () => {
    expect(s.byKind.cash).toBe(1_200_000);
    expect(s.byKind.guaranteed).toBe(500_000);
    expect(s.equityPct).toBe(15);
  });
  it("adds Portfolio holdings when no shares account is entered", () => {
    const t = summarize({ ...me, accounts: me.accounts.filter((a) => a.type !== "stocks") }, { portfolioValue: 250_000 });
    expect(t.byKind.market).toBe(250_000);
  });
});

describe("savings advice", () => {
  const adv = savingsAdvice(me, summarize(me), rates);
  it("puts expensive debt first", () => {
    expect(adv[0].area).toBe("debt");
    expect(adv[0].yearlyImpact).toBe(18_000);
  });
  it("flags spending above benchmarks with the rupee amount", () => {
    const housing = adv.find((a) => a.title.startsWith("Rent"));
    expect(housing?.amount).toBe(50_000 - 45_000);
    const dining = adv.find((a) => a.title.startsWith("Eating out"));
    expect(dining?.amount).toBe(20_000 - 12_000);
  });
  it("finds idle cash and the extra interest after tax", () => {
    const idle = adv.find((a) => a.area === "idle cash");
    expect(idle?.yearlyImpact).toBe(Math.round(682_500 * 0.03 * 0.94));
  });
  it("notes when deposits lose to inflation", () => {
    expect(adv.some((a) => a.area === "inflation")).toBe(true);
  });
});

describe("allocation", () => {
  it("never puts everything in shares, even at high risk and long horizon", () => {
    expect(equityCap("high", 30)).toBeLessThanOrEqual(70);
    expect(equityCap("low", 1)).toBeLessThan(5);
  });
  it("repays expensive debt and fills the emergency fund before investing", () => {
    const a = adviseAllocation({ amount: 500_000, risk: "medium", horizonYears: 7, emergencyGap: 100_000, expensiveDebt: [{ name: "Credit card", balance: 100_000, ratePct: 18 }], nearTermNeeds: [{ name: "Car down payment", amount: 100_000, years: 2 }], rates });
    expect(a.buckets.map((b) => b.name)).toEqual(["Repay Credit card", "Emergency fund", "Car down payment (in 2 yr)", "Fixed income (stability)", "Long-term growth (market-linked)"]);
    const total = a.buckets.reduce((s, b) => s + b.amount, 0);
    expect(total).toBe(500_000);
    const market = a.buckets.find((b) => b.kind === "market")!;
    expect(market.amount).toBe(Math.round(200_000 * a.equityCapPct / 100));
    expect(market.guaranteed).toBe(false);
  });
  it("leans new money to fixed income when shares are already overweight", () => {
    const base = adviseAllocation({ amount: 100_000, risk: "medium", horizonYears: 7, emergencyGap: 0, expensiveDebt: [], nearTermNeeds: [], rates });
    const heavy = adviseAllocation({ amount: 100_000, risk: "medium", horizonYears: 7, emergencyGap: 0, expensiveDebt: [], nearTermNeeds: [], rates, existingEquityPct: 80 });
    expect(heavy.equityCapPct).toBeLessThan(base.equityCapPct);
  });
});

describe("loans, deposits and debentures", () => {
  it("prefers prepaying a loan that costs more than the investment earns", () => {
    expect(loanVsInvest({ amount: 100_000, loanRatePct: 12, years: 3, investReturnPct: 5.6, investGuaranteed: true }).better).toBe("prepay");
    expect(loanVsInvest({ amount: 100_000, loanRatePct: 4, years: 3, investReturnPct: 8, investGuaranteed: true }).better).toBe("invest");
  });
  it("ranks deposits by after-tax maturity and filters by term", () => {
    const r = compareDeposits([{ institution: "A", ratePct: 5, tenorMonths: 12 }, { institution: "B", ratePct: 6, tenorMonths: 12 }, { institution: "C", ratePct: 9, tenorMonths: 60 }], 100_000, 12, 6, 6.34);
    expect(r.map((x) => x.institution)).toEqual(["B", "A"]);
    expect(r[0].interestNet).toBe(Math.round(100_000 * (Math.pow(1 + 0.015 * 0.94, 4) - 1)));
    expect(r[0].realPct).toBeLessThan(0);
  });
  it("reads coupon and maturity from a debenture name", () => {
    const d = debentureYield("10.50% Century Debenture 2088", 1050, "2026-11-09")!;
    expect(d.couponPct).toBe(10.5);
    expect(d.maturityBs).toBe(2088);
    expect(d.currentYieldPct).toBe(10);
    expect(d.approxYtmPct).toBeLessThan(10);
  });
  it("compounds monthly savings and annualises growth", () => {
    expect(Math.round(futureMonthly(10_000, 0, 12))).toBe(120_000);
    expect(cagr(100, 200, 10)!).toBeCloseTo(7.18, 1);
  });
});

describe("NRB parsers", () => {
  it("parses rate tables and skips unused instruments", () => {
    const html = `<table><tr><th>Rate Type</th><th>Current Rate</th><th>Previous Rate</th></tr>
      <tr><td>Policy Rate (Overnight Repo) <small>Last updated: December 2, 2025</small></td><td>4.2500 December 2, 2025</td><td>4.5000 July 17, 2025</td></tr>
      <tr><td>Dormant</td><td>0.0000 January 1, 1970</td><td>0.0000 January 1, 1970</td></tr></table>`;
    const r = parseNrbRates(html, "u", ["policy"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ key: "policy.policy_rate", value: 4.25, asOf: "2025-12-02", prevValue: 4.5, prevAsOf: "2025-07-17" });
  });
  it("reads inflation and headline points from the macro report text", () => {
    const m = parseMacroText("Based on Two Months Data (Ending Mid-September) of 2026/27 ▪ CPI-based inflation remained at 6.34 percent on y-o-y basis. ▪ Remittances increased 23.9 percent in NPR terms. 2026 October 15 Current Macroeconomic Inflation Consumer Price Inflation (CPI) 1. more");
    expect(m.inflation).toBe(6.34);
    expect(m.published).toBe("2026-10-15");
    expect(m.highlights[0]).toBe("CPI-based inflation remained at 6.34 percent on y-o-y basis.");
  });
});

import { resample, trendlines } from "../shared/timeframe.ts";
import type { Bar } from "../shared/types.ts";
describe("timeframes and trendlines", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 5) + i * 86_400_000).toISOString().slice(0, 10); // 2026-01-05 is a Monday
  const bars: Bar[] = Array.from({ length: 60 }, (_, i) => ({ date: day(i), open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i, volume: 10 }));
  it("builds weekly and monthly bars", () => {
    const w = resample(bars, "W");
    expect(w[0]).toMatchObject({ open: 100, high: 107, low: 98, close: 106, volume: 60, date: day(5) }); // Mon-Sat; Sunday starts the next NEPSE week
    expect(w.length).toBe(9);
    const m = resample(bars, "M");
    expect(m.map((b) => b.date.slice(0, 7))).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(m[0].open).toBe(100);
  });
  it("draws a rising support line through higher lows and flags a break", () => {
    // Zig-zag uptrend: swing lows rise by 5 every 10 bars, then the last bar collapses.
    const z: Bar[] = Array.from({ length: 80 }, (_, i) => { const base = 100 + i * 0.5 + (i % 10 < 5 ? (i % 10) : 10 - (i % 10)) * 2; return { date: day(i), open: base, high: base + 1, low: base - 1, close: base, volume: 10 }; });
    const t1 = trendlines(z);
    const sup = t1.find((t) => t.kind === "support");
    expect(sup).toBeTruthy();
    expect(sup!.slopePctPerBar).toBeGreaterThan(0);
    expect(sup!.broken).toBe(false);
    z[79] = { ...z[79], close: sup!.valueNow * 0.9, low: sup!.valueNow * 0.89, volume: 40 };
    const t2 = trendlines(z).find((t) => t.kind === "support")!;
    expect(t2.broken).toBe(true);
    expect(t2.volumeConfirmed).toBe(true);
  });
});

import { summarizeEntries, averageMonthly } from "../shared/money.ts";
import { classifyFiling } from "../server/ingest/providers.ts";
describe("income & expense tracker", () => {
  const e = [
    { date: "2026-11-01", type: "income" as const, category: "salary", amount: 150000 },
    { date: "2026-11-02", type: "expense" as const, category: "food", amount: 2500 },
    { date: "2026-11-02", type: "expense" as const, category: "invest", amount: 20000 },
    { date: "2026-11-05", type: "expense" as const, category: "emi", amount: 10000 },
    { date: "2026-10-03", type: "expense" as const, category: "food", amount: 6000 },
  ];
  it("totals a month with savings kept apart from spending", () => {
    const s = summarizeEntries(e.filter((x) => x.date.startsWith("2026-11")));
    expect(s.income).toBe(150000);
    expect(s.spending).toBe(12500);
    expect(s.invested).toBe(20000);
    expect(s.emi).toBe(10000);
    expect(s.net).toBe(137500);
    expect(s.days[0].date).toBe("2026-11-05");
  });
  it("averages spending per category over full months", () => {
    expect(averageMonthly(e, ["2026-10", "2026-11"]).find((x) => x.category === "food")?.amount).toBe(4250);
  });
  it("classifies official filings", () => {
    expect(classifyFiling("Nabil Bank - Information regarding appointment of Statutory Auditor for FY 2082/83")).toBe("Auditor appointment");
    expect(classifyFiling("Minutes of 42nd Annual General Meeting of Nabil Bank Limited")).toBe("AGM minutes");
    expect(classifyFiling("Annual Audit Report [TPC]")).toBe("Audited / annual report");
  });
});

import { debtPlan, compareProfiles } from "../shared/money.ts";
describe("debt planner and portfolio comparison", () => {
  const loans = [
    { id: "a", name: "Card", type: "credit_card" as const, balance: 100000, ratePct: 18, emi: 5000 },
    { id: "b", name: "Car", type: "car" as const, balance: 500000, ratePct: 11, emi: 12000 },
  ];
  it("pays highest rate first with avalanche and saves interest vs no extra", () => {
    const base = debtPlan(loans, 0, "avalanche")!;
    const fast = debtPlan(loans, 10000, "avalanche")!;
    expect(fast.feasible && base.feasible).toBe(true);
    if (fast.feasible && base.feasible) {
      expect(fast.order[0].name).toBe("Card");
      expect(fast.months).toBeLessThan(base.months);
      expect(fast.totalInterest).toBeLessThan(base.totalInterest);
    }
  });
  it("orders smallest balance first with snowball", () => {
    const s = debtPlan(loans, 10000, "snowball")!;
    if (s.feasible) expect(s.order[0].name).toBe("Card");
  });
  it("builds three portfolios that add up and keep equity below 100%", () => {
    const p = compareProfiles(500000, rates);
    for (const x of p) {
      expect(x.parts.reduce((s, y) => s + y.pct, 0)).toBe(100);
      expect(x.protectedPct).toBeGreaterThanOrEqual(30);
    }
    expect(p[0].protectedPct).toBeGreaterThan(p[2].protectedPct);
  });
});

import { evaluate } from "../shared/opportunities.ts";
describe("trading opportunities", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  it("refuses to signal on too little history", () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({ date: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
    const o = evaluate({ symbol: "X", name: "X", sector: "S", bars, fundamentals: null, avgTurnover20: 5e6, latestMarketDate: day(49) });
    expect(o.action).toBe("INSUFFICIENT");
  });
  it("refuses stale prices", () => {
    const bars = Array.from({ length: 200 }, (_, i) => ({ date: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
    const o = evaluate({ symbol: "X", name: "X", sector: "S", bars, fundamentals: null, avgTurnover20: 5e6, latestMarketDate: day(230) });
    expect(o.action).toBe("INSUFFICIENT");
    expect(o.headline).toMatch(/stale/);
  });
  it("marks illiquid stocks as avoid instead of signalling", () => {
    const bars = Array.from({ length: 200 }, (_, i) => ({ date: day(i), open: 100 + i * 0.2, high: 101 + i * 0.2, low: 99 + i * 0.2, close: 100 + i * 0.2, volume: 1000 }));
    const o = evaluate({ symbol: "X", name: "X", sector: "S", bars, fundamentals: null, avgTurnover20: 200_000, latestMarketDate: day(199) });
    expect(o.action).toBe("AVOID");
  });
  it("never issues a BUY whose stop sits inside the buy range", () => {
    const bars = Array.from({ length: 260 }, (_, i) => { const c = 100 + i * 0.4 + (i % 7) - 3; return { date: day(i), open: c - 0.5, high: c + 1.5, low: c - 1.5, close: c, volume: 5000 + (i % 5) * 1000 }; });
    const o = evaluate({ symbol: "X", name: "X", sector: "S", bars, fundamentals: null, avgTurnover20: 5e6, latestMarketDate: day(259) });
    if (o.action === "BUY") { expect(o.stop!).toBeLessThan(o.entryLow!); expect(o.riskReward!).toBeLessThanOrEqual(8); }
  });
});
