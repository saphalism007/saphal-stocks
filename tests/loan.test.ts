import { describe, expect, it } from "vitest";
import { amortise, solve, addPeriod, buyOrFinance, type LoanResult } from "../shared/loan.ts";
const ok = (x: ReturnType<typeof amortise>) => { if (!x.ok) throw new Error(x.error); return x as LoanResult; };

describe("loan amortisation", () => {
  it("matches the standard EMI", () => {
    const r = ok(amortise({ principal: 1_000_000, ratePct: 12, installments: 12, start: "2026-01-15" }));
    expect(r.installment).toBeCloseTo(88848.79, 1);
    expect(r.totalInterest).toBeCloseTo(66185.44, 0);
    expect(r.rows).toHaveLength(12);
    expect(r.rows[11].closing).toBe(0);
    expect(r.rows[0].date).toBe("2026-02-15");
  });
  it("solves the missing input", () => {
    expect(Math.round(solve({ principal: 1_000_000, ratePct: 12, installment: 88848.79 }).n as number)).toBe(12);
    expect((solve({ principal: 1_000_000, installments: 12, installment: 88848.79 }) as { rate: number }).rate).toBeCloseTo(12, 2);
    expect((solve({ ratePct: 12, installments: 12, installment: 88848.79 }) as { P: number }).P).toBeCloseTo(1_000_000, -1);
    expect("error" in solve({ principal: 100000 })).toBe(true);
    expect("error" in solve({ principal: 100000, ratePct: 12, installment: 500 })).toBe(true); // doesn't cover interest
  });
  it("price minus down payment, equal principal, interest-only and balloon", () => {
    expect(ok(amortise({ price: 3_000_000, downPaymentPct: 20, ratePct: 10, years: 5 })).principal).toBe(2_400_000);
    const ep = ok(amortise({ principal: 120000, ratePct: 12, installments: 12, method: "equal-principal" }));
    expect(ep.rows[0].principal).toBe(10000); expect(ep.rows[0].payment).toBeGreaterThan(ep.rows[11].payment);
    const io = ok(amortise({ principal: 100000, ratePct: 12, installments: 12, method: "interest-only" }));
    expect(io.rows[0].principal).toBe(0); expect(io.rows[11].principal).toBe(100000);
    const bl = ok(amortise({ principal: 100000, ratePct: 12, installments: 12, method: "balloon", balloonPct: 30 }));
    expect(bl.rows[11].principal).toBeGreaterThan(29000); expect(bl.rows[11].closing).toBe(0);
  });
  it("prepayments shorten the loan and save interest; rate change recalculates", () => {
    const base = ok(amortise({ principal: 1_000_000, ratePct: 12, years: 10 }));
    const ex = ok(amortise({ principal: 1_000_000, ratePct: 12, years: 10, extraEach: 5000, lumps: [{ at: 12, amount: 100000 }] }));
    expect(ex.installments).toBeLessThan(base.installments);
    expect(ex.savedByExtras!.interest).toBeGreaterThan(100000);
    const red = ok(amortise({ principal: 1_000_000, ratePct: 12, years: 10, lumps: [{ at: 12, amount: 200000 }], prepayMode: "reduce" }));
    expect(red.rows[12].payment).toBeLessThan(red.rows[10].payment);
    const fl = ok(amortise({ principal: 1_000_000, ratePct: 10, years: 5, rateChanges: [{ at: 13, ratePct: 13 }] }));
    expect(fl.rows[12].payment).toBeGreaterThan(fl.rows[11].payment);
    expect(fl.rows[fl.rows.length - 1].closing).toBe(0);
  });
  it("grace period, daily actual-days interest, fees and very long schedules", () => {
    const g = ok(amortise({ principal: 100000, ratePct: 12, installments: 24, graceInstallments: 6 }));
    expect(g.rows[0].principal).toBe(0); expect(g.rows).toHaveLength(24);
    const d = ok(amortise({ principal: 1_000_000, ratePct: 12, installments: 12, basis: "actual365", start: "2026-01-01" }));
    expect(d.rows[d.rows.length - 1].closing).toBe(0);
    const fee = ok(amortise({ principal: 1_000_000, ratePct: 12, installments: 12, feePct: 1 }));
    expect(fee.aprWithFeesPct!).toBeGreaterThan(fee.effectiveAnnualPct);
    const long = ok(amortise({ principal: 5_000_000, ratePct: 9, years: 100, freq: "daily" }));
    expect(long.rows.length).toBeGreaterThan(36000);
    expect(long.rows[long.rows.length - 1].closing).toBe(0);
    expect(addPeriod("2026-01-31", "monthly", 1)).toBe("2026-02-28");
  });
  it("cash vs loan-and-invest", () => {
    const loan = ok(amortise({ principal: 1_000_000, ratePct: 10, years: 3 }));
    const hi = buyOrFinance({ price: 1_000_000, cash: 1_000_000, downPayment: 0, loan, investReturnPct: 20, taxOnReturnPct: 0, freq: "monthly" });
    const lo = buyOrFinance({ price: 1_000_000, cash: 1_000_000, downPayment: 0, loan, investReturnPct: 5, taxOnReturnPct: 0, freq: "monthly" });
    expect(hi.better).toBe("loan"); expect(lo.better).toBe("cash");
  });
});

import { toBS, fromBS, fiscalYearOf } from "../web/src/lib/bs.ts";
describe("Nepali calendar", () => {
  it("matches known dates and fiscal years", () => {
    expect(toBS("2026-04-14")).toEqual({ y: 2083, m: 1, d: 1 });
    expect(toBS("2026-07-17")).toEqual({ y: 2083, m: 4, d: 1 });
    expect(fiscalYearOf(toBS("2026-07-16")!)).toBe("2082/83");
    expect(fiscalYearOf(toBS("2026-07-17")!)).toBe("2083/84");
    expect(fromBS({ y: 2083, m: 4, d: 1 })).toBe("2026-07-17");
    expect(toBS("2040-01-01")).toBeNull(); // beyond BS 2090
  });
});
