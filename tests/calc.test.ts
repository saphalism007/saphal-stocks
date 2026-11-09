import { describe, expect, it } from "vitest";
import { incomeTax, stepUpSip, goalMonthly, realReturn, retirement, averagePrice, adjustedPrice, ytm, loanAffordability, goldCost, doublingYears } from "../shared/calc.ts";

const base = { retirement: 0, retirementCap: 500_000, lifeInsurance: 0, lifeCap: 40_000, healthInsurance: 0, healthCap: 20_000, buildingInsurance: 0, childEducationFees: 0, ssfContributor: false, female: false };
describe("income tax FY 2083/84", () => {
  it("applies the new single table", () => {
    expect(incomeTax({ ...base, annualIncome: 1_000_000 }).tax).toBe(10_000);
    expect(incomeTax({ ...base, annualIncome: 1_500_000 }).tax).toBe(60_000);
    expect(incomeTax({ ...base, annualIncome: 2_500_000 }).tax).toBe(260_000);
    expect(incomeTax({ ...base, annualIncome: 5_000_000 }).tax).toBe(260_000 + 405_000 + 290_000);
  });
  it("deductions, SSF and the women's rebate", () => {
    const t = incomeTax({ ...base, annualIncome: 1_200_000, retirement: 600_000, lifeInsurance: 50_000, ssfContributor: true, female: true });
    expect(t.deductions.retirement).toBe(400_000); // 1/3 of income
    expect(t.deductions.life).toBe(40_000);
    expect(t.taxable).toBe(760_000);
    expect(t.tax).toBe(0); // 1% band waived for SSF
    expect(incomeTax({ ...base, annualIncome: 1_500_000, female: true }).tax).toBe(54_000);
  });
});
describe("growth calculators", () => {
  it("SIP, goal and doubling", () => {
    expect(stepUpSip(10_000, 0, 1).value).toBe(120_000);
    expect(stepUpSip(10_000, 10, 10, 10).paid).toBeGreaterThan(stepUpSip(10_000, 10, 10).paid);
    expect(goalMonthly(1_200_000, 10, 0, 0).monthly).toBe(10_000);
    expect(Math.round(doublingYears(10)!)).toBe(7);
    expect(realReturn(10, 0, 10).real).toBe(0);
    expect(retirement({ age: 30, retireAge: 60, lifeTo: 85, monthlyExpense: 50_000, inflationPct: 6, returnBeforePct: 10, returnAfterPct: 7, saved: 0 }).corpus).toBeGreaterThan(50_000_000);
  });
});
describe("share and property calculators", () => {
  it("average, bonus, YTM, affordability, gold", () => {
    expect(averagePrice(100, 500, 100, 400).avg).toBe(450);
    expect(adjustedPrice(1100, 10, 0).afterBonus).toBe(1000);
    expect(ytm(1000, 1000, 10, 5).ytm).toBeCloseTo(10, 1);
    expect(loanAffordability(100_000, 0, 0, 10).maxLoan).toBe(6_000_000);
    expect(goldCost({ tola: 1, ratePerTola: 200_000, makingPerTola: 0, skillFeePct: 0, buybackDiscountPct: 0 }).breakEvenRisePct).toBe(0);
  });
});
