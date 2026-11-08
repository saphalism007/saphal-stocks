import { describe, it, expect } from "vitest";
import { sma, ema, rsi, macd, atr, bollinger, pivotPoints, fibonacci, obv, vwap, supertrend, adx, stochastic } from "../shared/indicators.ts";
import { brokerCommission, buyCost, sellCost, roundTrip, cgtRate } from "../shared/costs.ts";
import { computeHoldings } from "../shared/portfolio.ts";
import { emi, futureValue, requiredMonthly, planGoal, fdMaturity, allocateLumpSum } from "../shared/planner.ts";
import { runBacktest } from "../shared/backtest.ts";
import { analyzeLevels, findSwings } from "../shared/levels.ts";
import { detectPatterns } from "../shared/patterns.ts";
import { adjustForBonus } from "../shared/adjust.ts";
import { analyzeFundamentals, parsePeriod, scale, dividendDiscount, grahamNumber } from "../shared/fundamentals.ts";
import { rankStocks, RANK_STRATEGIES, type StockFactors } from "../shared/ranking.ts";
import type { Bar } from "../shared/types.ts";

const mkBars = (closes: number[], start = "2025-01-01"): Bar[] =>
  closes.map((c, i) => {
    const d = new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000 + (i % 7) * 100, amount: c * (1000 + (i % 7) * 100) };
  });

describe("indicators", () => {
  it("SMA and EMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2); // seeded with SMA
    expect(e[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(e[4]).toBeCloseTo(4, 10);
  });

  it("RSI matches the Wilder reference example (StockCharts)", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const r = rsi(closes, 14);
    expect(r[13]).toBeNull();
    expect(r[14]).toBeCloseTo(70.53, 0);
    expect(r[15]).toBeCloseTo(66.32, 0);
    expect(r[19]).toBeCloseTo(57.92, 0);
  });

  it("MACD line equals EMA12 - EMA26", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.2);
    const m = macd(closes);
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    expect(m.macd[60]).toBeCloseTo((e12[60] as number) - (e26[60] as number), 10);
    expect(m.signal[33]).not.toBeNull();
    expect(m.signal[32]).toBeNull();
  });

  it("Bollinger, ATR, ADX, stochastic, supertrend produce sane values", () => {
    const bars = mkBars(Array.from({ length: 120 }, (_, i) => 100 + i));
    const bb = bollinger(bars.map((b) => b.close));
    expect((bb.upper[50] as number) > (bb.middle[50] as number)).toBe(true);
    const a = atr(bars);
    expect(a[13]).not.toBeNull();
    expect(a[12]).toBeNull();
    const ad = adx(bars);
    expect((ad.adx[119] as number) > 50).toBe(true); // steady uptrend = strong trend
    expect((ad.plusDI[119] as number) > (ad.minusDI[119] as number)).toBe(true);
    const st = supertrend(bars);
    expect(st.direction[119]).toBe(1);
    const sto = stochastic(bars);
    expect(sto.k[119] as number).toBeGreaterThan(80);
  });

  it("pivots and Fibonacci", () => {
    const p = pivotPoints({ high: 110, low: 90, close: 100 });
    expect(p.pp).toBe(100);
    expect(p.r1).toBe(110);
    expect(p.s1).toBe(90);
    const f = fibonacci(100, 200, "up");
    expect(f.retracements.find((x) => x.ratio === 0.618)!.price).toBeCloseTo(138.2, 6);
    expect(f.extensions.find((x) => x.ratio === 1.618)!.price).toBeCloseTo(261.8, 6);
  });

  it("OBV and VWAP from turnover", () => {
    const bars: Bar[] = [
      { date: "2025-01-01", open: 10, high: 10, low: 10, close: 10, volume: 100, amount: 1000 },
      { date: "2025-01-02", open: 11, high: 11, low: 11, close: 11, volume: 50, amount: 560 },
      { date: "2025-01-03", open: 10, high: 10, low: 10, close: 10.5, volume: 20, amount: 210 },
    ];
    expect(obv(bars)).toEqual([0, 50, 30]);
    expect(vwap(bars, 3).daily[1]).toBeCloseTo(11.2, 10);
    expect(vwap(bars, 3).rolling[2]).toBeCloseTo(1770 / 170, 10);
  });
});

describe("Nepal costs", () => {
  it("commission slabs and minimum", () => {
    expect(brokerCommission(1000)).toBe(10); // 0.36% = 3.6 -> min Rs.10
    expect(brokerCommission(50_000)).toBeCloseTo(180, 6);
    expect(brokerCommission(100_000)).toBeCloseTo(330, 6);
    expect(brokerCommission(1_000_000)).toBeCloseTo(3100, 6);
    expect(brokerCommission(5_000_000)).toBeCloseTo(13500, 6);
    expect(brokerCommission(20_000_000)).toBeCloseTo(48000, 6);
  });
  it("buy/sell charges and CGT", () => {
    const b = buyCost(100, 500); // 50,000
    expect(b.commission).toBeCloseTo(180, 6);
    expect(b.sebonFee).toBeCloseTo(7.5, 6);
    expect(b.net).toBeCloseTo(50187.5, 6);
    const s = sellCost(100, 600); // 60,000 -> 0.33%
    expect(s.commission).toBeCloseTo(198, 6);
    expect(s.dpCharge).toBe(25);
    expect(s.net).toBeCloseTo(60000 - 198 - 9 - 25, 6);
    expect(cgtRate(100)).toBe(0.075);
    expect(cgtRate(400)).toBe(0.05);
    const rt = roundTrip(100, 500, 600, 100);
    expect(rt.grossGain).toBeCloseTo(s.net - b.net, 6);
    expect(rt.cgt).toBeCloseTo(rt.grossGain * 0.075, 6);
    expect(rt.breakevenPrice).toBeGreaterThan(500);
    expect(rt.breakevenPrice).toBeLessThan(505);
  });
});

describe("portfolio WACC", () => {
  it("averages cost incl. charges, handles bonus and sells", () => {
    const s = computeHoldings(
      [
        { symbol: "ABC", type: "buy", date: "2025-01-01", quantity: 100, price: 500 },
        { symbol: "ABC", type: "bonus", date: "2025-06-01", quantity: 10, price: 100 },
        { symbol: "ABC", type: "sell", date: "2026-03-01", quantity: 50, price: 700 },
        { symbol: "ABC", type: "cash_dividend", date: "2025-09-01", quantity: 0, price: 1000 },
      ],
      { ABC: 650 },
      undefined,
      "2026-06-01",
    );
    const h = s.holdings[0];
    expect(h.quantity).toBe(60);
    const wacc = (50187.5 + 1000) / 110;
    expect(h.wacc).toBeCloseTo(wacc, 6);
    expect(h.costBasis).toBeCloseTo(wacc * 60, 4);
    const proceeds = 35000 - (35000 * 0.0036 + 35000 * 0.00015 + 25); // Rs. 35,000 is in the 0.36% slab
    const gain = proceeds - wacc * 50;
    expect(h.realizedPnl).toBeCloseTo(gain - gain * 0.05, 4); // held > 365 days -> 5%
    expect(h.dividendsReceived).toBeCloseTo(950, 6);
    expect(h.marketValue).toBe(39000);
  });
});

describe("planner", () => {
  it("EMI matches the standard formula", () => {
    const e = emi(1_000_000, 12, 12)!;
    expect(e.payment).toBeCloseTo(88848.79, 1);
    expect(e.schedule[e.schedule.length - 1].balance).toBeCloseTo(0, 4);
  });
  it("future value and required monthly are inverses", () => {
    const req = requiredMonthly(1_000_000, 100_000, 10, 60);
    expect(futureValue(100_000, req, 10, 60).value).toBeCloseTo(1_000_000, 2);
  });
  it("goal plan accounts for inflation", () => {
    const p = planGoal({ name: "Car", costToday: 6_000_000, years: 5, inflationPct: 5, currentSaved: 1_000_000, monthlyCapacity: 50_000 });
    expect(p.targetFutureCost).toBeCloseTo(6_000_000 * 1.05 ** 5, 2);
    expect(p.scenarios).toHaveLength(3);
    expect(p.scenarios[0].requiredMonthly).toBeGreaterThan(p.scenarios[2].requiredMonthly);
    const sim = p.scenarios[1].simulated;
    expect(sim.p10).toBeLessThan(sim.p90);
  });
  it("FD with interest tax", () => {
    const f = fdMaturity(100_000, 8, 1, 4, 0);
    expect(f.maturity).toBeCloseTo(100_000 * 1.02 ** 4, 4);
    expect(fdMaturity(100_000, 8, 1, 4, 6).maturity).toBeLessThan(f.maturity);
  });
  it("allocation never recommends everything into stocks and respects priorities", () => {
    const a = allocateLumpSum({ amount: 1_000_000, emergencyFundGap: 200_000, highInterestDebt: 100_000, horizonYears: 10, risk: "high", nearTermGoalAmount: 0, nearTermGoalYears: 10 });
    expect(a.steps[0].bucket).toMatch(/debt/);
    expect(a.steps[1].bucket).toMatch(/Emergency/);
    const eq = a.steps.find((s) => s.bucket.startsWith("Equity"))!.amount;
    expect(eq).toBeLessThan(1_000_000);
    expect(a.steps.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1_000_000, 6);
  });
});

describe("backtest", () => {
  it("fills at next open (no look-ahead) and applies costs", () => {
    const closes = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 60 }, (_, i) => 100 + i * 2), ...Array.from({ length: 60 }, (_, i) => 220 - i * 2)];
    const bars = mkBars(closes).map((b, i, arr) => ({ ...b, open: i > 0 ? arr[i - 1].close : b.close }));
    const r = runBacktest(bars, { strategy: "sma_cross", params: { fast: 5, slow: 20 }, capital: 100_000, slippagePct: 0 });
    expect(r.trades.length).toBeGreaterThan(0);
    const t = r.trades[0];
    const sigIdx = bars.findIndex((b) => b.date === t.entryDate) - 1;
    expect(t.entryPrice).toBe(bars[sigIdx + 1].open);
    expect(r.stats.totalCosts).toBeGreaterThan(0);
    expect(r.stats.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });
});

describe("levels and patterns", () => {
  it("finds a support level that was tested several times", () => {
    const closes: number[] = [];
    for (let k = 0; k < 6; k++) { for (let i = 0; i < 10; i++) closes.push(100 + i * 2); for (let i = 0; i < 10; i++) closes.push(120 - i * 2); }
    closes.push(...Array.from({ length: 5 }, (_, i) => 110 + i));
    const bars = mkBars(closes);
    expect(findSwings(bars).length).toBeGreaterThan(4);
    const lv = analyzeLevels(bars)!;
    const s = lv.supports.filter((l) => Math.abs(l.price - 100) < 4).sort((a, b) => b.reactions - a.reactions)[0];
    expect(s).toBeTruthy();
    expect(s!.reactions).toBeGreaterThanOrEqual(3);
    expect(s!.strength).toBe("major");
    expect(lv.resistances.some((l) => Math.abs(l.price - 120) < 4)).toBe(true);
  });

  it("detects a confirmed double bottom", () => {
    const seg = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * (i + 1)) / n);
    const closes = [...Array.from({ length: 40 }, () => 130), ...seg(130, 100, 15), ...seg(100, 120, 12), ...seg(120, 100.5, 12), ...seg(100.5, 125, 12)];
    const p = detectPatterns(mkBars(closes));
    const db = p.find((x) => x.name === "Double bottom");
    expect(db).toBeTruthy();
    expect(db!.status).toBe("confirmed");
    expect(db!.target!).toBeGreaterThan(db!.keyLevel!);
  });

  it("detects a breakout on volume", () => {
    const closes = [...Array.from({ length: 80 }, (_, i) => 100 + (i % 4)), 110];
    const bars = mkBars(closes);
    bars[bars.length - 1].volume = 10_000;
    const p = detectPatterns(bars);
    const bo = p.find((x) => x.name === "Breakout")!;
    expect(bo.status).toBe("confirmed");
  });
});

describe("bonus adjustment", () => {
  it("applies only when the gap appears", () => {
    const closes = [...Array.from({ length: 20 }, () => 220), ...Array.from({ length: 20 }, () => 200)];
    const bars = mkBars(closes).map((b, i, arr) => ({ ...b, open: i > 0 ? arr[i - 1].close * (i === 20 ? 200 / 220 : 1) : b.close }));
    const r = adjustForBonus(bars, [{ bookCloseDate: bars[20].date, bonusPct: 10 }, { bookCloseDate: bars[5].date, bonusPct: 20 }]);
    expect(r.applied).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.bars[0].close).toBeCloseTo(200, 6);
  });
});

describe("fundamentals", () => {
  const items = (rows: [string, string, number][]) => rows.map(([statement, label, value]) => ({ statement: statement as "balance_sheet", label, value }));
  it("computes bank ratios from statements (NABIL Q1 2083/84 figures)", () => {
    const fa = analyzeFundamentals({
      symbol: "NABIL", sector: "Commercial Bank", price: 549, priceDate: "2026-11-06", listedShares: 284_098_483, faceValue: 100,
      reports: [{
        symbol: "NABIL", period: "1st Quarter 2083/2084", fiscalYear: "2083/2084", quarter: 1, source: "test", fetchedAt: "",
        items: items([
          ["balance_sheet", "Total Assets", 775_666_476], ["balance_sheet", "Total equity", 71_451_660],
          ["balance_sheet", "Loans and advances to customers", 476_013_619], ["balance_sheet", "Deposits from customers", 619_231_995],
          ["income", "Net interest income", 4_737_012], ["income", "Total operating income", 6_136_516],
          ["income", "Personnel expense", 1_680_680], ["income", "Other operating expense", 453_026], ["income", "Depreciation & Amortisation", 166_850],
          ["income", "Profit for the period", 2_555_104],
          ["metrics", "Basic Earnings Per Share(Annualized EPS)", 30.34], ["metrics", "Capital fund to RWA", 11.67],
          ["metrics", "Non-Performing loan(NPL) to Total Loan", 4.06], ["metrics", "Net Worth Per Share", 233.9], ["metrics", "Return on Equity", 12.97],
        ]),
      }],
      dividends: [{ fiscalYear: "2082/2083", cashPct: 10.8, bonusPct: 5, bookCloseDate: "2026-09-30", announcementDate: null }],
    });
    const k = fa.byKey;
    expect(k.eps).toBeCloseTo((2_555_104 * 4 * 1000) / 284_098_483, 2); // no share-capital line in this fixture -> listed shares
    expect(k.bvps).toBeCloseTo((71_451_660 * 1000) / 284_098_483, 2);
    expect(k.roe).toBeCloseTo(((2_555_104 * 4) / 71_451_660) * 100, 2);
    expect(k.npl).toBe(4.06);
    expect(k.car).toBe(11.67);
    expect(k.costIncome).toBeCloseTo(((1_680_680 + 453_026 + 166_850) / 6_136_516) * 100, 2);
    expect(fa.dividend.cashYieldPct).toBeCloseTo((10.8 / 549) * 100, 2);
    expect(fa.score.overall).not.toBeNull();
    expect(fa.dataNotes.some((n) => n.includes("differs from the reported EPS"))).toBe(true);
  });
  it("helpers", () => {
    expect(parsePeriod("1st Quarter 2083/2084")).toEqual({ fiscalYear: "2083/2084", quarter: 1 });
    expect(parsePeriod("4th Quarter 2082/83")).toEqual({ fiscalYear: "2082/2083", quarter: 4 });
    expect(scale(5, 0, 10)).toBe(50);
    expect(scale(2, 10, 0)).toBe(80);
    expect(grahamNumber(10, 100)).toBeCloseTo(150, 6);
    expect(dividendDiscount(10, 0.05, 0.12)).toBeCloseTo(150, 6);
  });
});

describe("ranking", () => {
  it("ranks by strategy weights and excludes ineligible", () => {
    const base: StockFactors = { symbol: "A", name: "A", sector: "x", price: 100, asOf: null, avgTurnover20: 1e7, fundamentalScore: 70, profitabilityScore: 70, valuationScore: 80, healthScore: 60, dividendScore: 50, growthScore: null, technicalScore: 50, roe: 15, pe: 12, pb: 1.2, eps: 8, cashYield: 3, yearsPaid5: 5, profitGrowthYoY: 10, return1m: 1, return3m: 5, return6m: 8, return1y: 10, rsi: 55, adx: 20, trend: "uptrend", atrPct: 2, volatility: 25, distFrom52wHighPct: -5, setupQuality: null, setupType: null, redFlags: 0 };
    const rows = [base, { ...base, symbol: "B", valuationScore: 20 }, { ...base, symbol: "C", eps: -1 }];
    const value = RANK_STRATEGIES.find((s) => s.key === "value")!;
    const r = rankStocks(rows, value);
    expect(r.ranked.map((x) => x.symbol)).toEqual(["A", "B"]);
    expect(r.ranked[0].score).toBeGreaterThan(r.ranked[1].score);
  });
});

describe("dividend sustainability", () => {
  const base = (cashPct: number, bonusPct = 0) => analyzeFundamentals({
    symbol: "X", sector: "Commercial Bank", price: 500, priceDate: null, listedShares: 1_000_000, faceValue: 100,
    reports: [{ symbol: "X", period: "4th Quarter 2082/2083", fiscalYear: "2082/2083", quarter: 4, source: "t", fetchedAt: "",
      items: [{ statement: "balance_sheet", label: "Total equity", value: 200_000 }, { statement: "income", label: "Profit for the period", value: 20_000 }] }],
    dividends: [2082, 2081, 2080, 2079, 2078].map((y) => ({ fiscalYear: `${y}/${y + 1}`, cashPct, bonusPct, bookCloseDate: null, announcementDate: null })),
  });
  it("computes payout from last dividend and annualised EPS", () => {
    const fa = base(10); // EPS = 20,000k / 1M = Rs. 20; DPS = Rs. 10
    expect(fa.byKey.eps).toBeCloseTo(20, 6);
    expect(fa.byKey.payoutCash).toBeCloseTo(50, 6);
    expect(fa.strengths.some((s) => s.includes("Sustainable-looking dividend"))).toBe(true);
  });
  it("flags dividends larger than earnings and bonus-heavy history", () => {
    const fa = base(25, 30);
    expect(fa.redFlags.some((s) => s.includes("may not be sustainable"))).toBe(true);
    expect(fa.dataNotes.some((s) => s.includes("dilution"))).toBe(true);
  });
});
