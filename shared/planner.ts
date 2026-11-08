// Personal finance calculators and goal planning for Nepal. Pure functions.
// Return assumptions are inputs, never promises: every projection is shown as
// conservative / moderate / aggressive scenarios plus a simulated range.

export function emi(principal: number, annualRatePct: number, months: number) {
  if (months <= 0) return null;
  const r = annualRatePct / 100 / 12;
  const payment = r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  const total = payment * months;
  const schedule: { month: number; payment: number; interest: number; principal: number; balance: number }[] = [];
  let bal = principal;
  for (let m = 1; m <= months; m++) {
    const interest = bal * r;
    const pr = payment - interest;
    bal = Math.max(0, bal - pr);
    if (m <= 12 || m % 12 === 0 || m === months) schedule.push({ month: m, payment, interest, principal: pr, balance: bal });
  }
  return { payment, totalPaid: total, totalInterest: total - principal, schedule };
}

/** Future value of a monthly contribution (end of month) plus a lump sum. */
export function futureValue(lump: number, monthly: number, annualReturnPct: number, months: number, annualStepUpPct = 0) {
  const r = annualReturnPct / 100 / 12;
  let v = lump;
  let c = monthly;
  let contributed = lump;
  for (let m = 1; m <= months; m++) {
    v = v * (1 + r) + c;
    contributed += c;
    if (m % 12 === 0) c *= 1 + annualStepUpPct / 100;
  }
  return { value: v, contributed, growth: v - contributed };
}

/** Monthly contribution needed to reach `target` in `months`, given a lump sum. */
export function requiredMonthly(target: number, lump: number, annualReturnPct: number, months: number) {
  const r = annualReturnPct / 100 / 12;
  const fvLump = lump * Math.pow(1 + r, months);
  const remaining = target - fvLump;
  if (remaining <= 0) return 0;
  if (r === 0) return remaining / months;
  return (remaining * r) / (Math.pow(1 + r, months) - 1);
}

export function inflate(amountToday: number, inflationPct: number, years: number) {
  return amountToday * Math.pow(1 + inflationPct / 100, years);
}

export function realReturn(nominalPct: number, inflationPct: number) {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

/** Fixed deposit maturity with periodic compounding and interest tax withheld on each credit. */
export function fdMaturity(principal: number, annualRatePct: number, years: number, compoundingPerYear = 4, interestTaxPct = 6) {
  const periods = Math.round(years * compoundingPerYear);
  const r = annualRatePct / 100 / compoundingPerYear;
  let bal = principal;
  let tax = 0;
  for (let i = 0; i < periods; i++) {
    const interest = bal * r;
    const t = interest * (interestTaxPct / 100);
    tax += t;
    bal += interest - t;
  }
  return { maturity: bal, interestNet: bal - principal, taxPaid: tax, effectiveAnnualPct: (Math.pow(bal / principal, 1 / years) - 1) * 100 };
}

export interface ScenarioAssumption { name: "Conservative" | "Moderate" | "Aggressive"; returnPct: number; volatilityPct: number; description: string }

export const DEFAULT_SCENARIOS: ScenarioAssumption[] = [
  { name: "Conservative", returnPct: 7, volatilityPct: 3, description: "Mostly fixed deposits, government bonds and debentures; little equity." },
  { name: "Moderate", returnPct: 10, volatilityPct: 10, description: "Roughly half fixed income, half diversified equity / mutual funds." },
  { name: "Aggressive", returnPct: 13, volatilityPct: 22, description: "Mostly NEPSE equities and equity mutual funds; large swings likely." },
];

/** Deterministic pseudo-random generator so simulations are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function normal(rand: () => number) {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Monte Carlo of annual returns (lognormal-ish) for a monthly savings plan. Returns percentiles of final value and P(reach target). */
export function simulateGoal(params: { lump: number; monthly: number; months: number; returnPct: number; volatilityPct: number; target: number; runs?: number; seed?: number; costPct?: number }) {
  const runs = params.runs ?? 2000;
  const rand = rng(params.seed ?? 42);
  const finals: number[] = [];
  const years = Math.ceil(params.months / 12);
  let success = 0;
  for (let k = 0; k < runs; k++) {
    let v = params.lump;
    let m = 0;
    for (let y = 0; y < years; y++) {
      const annual = params.returnPct / 100 - (params.costPct ?? 0) / 100 + (params.volatilityPct / 100) * normal(rand);
      const monthlyR = Math.pow(Math.max(0.01, 1 + annual), 1 / 12) - 1;
      for (let i = 0; i < 12 && m < params.months; i++, m++) v = v * (1 + monthlyR) + params.monthly;
    }
    finals.push(v);
    if (v >= params.target) success++;
  }
  finals.sort((a, b) => a - b);
  const pctl = (p: number) => finals[Math.min(finals.length - 1, Math.floor(p * finals.length))];
  return { p10: pctl(0.1), p50: pctl(0.5), p90: pctl(0.9), probabilityOfSuccess: success / runs };
}

export interface GoalInput {
  name: string;
  costToday: number; // in today's Rs.
  years: number;
  inflationPct: number; // goal-specific inflation (e.g. vehicles, land differ)
  currentSaved: number;
  monthlyCapacity: number;
  annualStepUpPct?: number;
  investmentCostPct?: number; // fund fees, commissions (drag on returns)
  taxOnGainsPct?: number; // effective tax on growth (e.g. 5-7.5% CGT, 6% interest tax)
  scenarios?: ScenarioAssumption[];
}

export function planGoal(g: GoalInput) {
  const months = Math.round(g.years * 12);
  const target = inflate(g.costToday, g.inflationPct, g.years);
  const scen = (g.scenarios || DEFAULT_SCENARIOS).map((s) => {
    const net = s.returnPct - (g.investmentCostPct ?? 0);
    const taxDrag = (net * (g.taxOnGainsPct ?? 0)) / 100;
    const eff = net - taxDrag;
    const req = requiredMonthly(target, g.currentSaved, eff, months);
    const fv = futureValue(g.currentSaved, g.monthlyCapacity, eff, months, g.annualStepUpPct ?? 0);
    const sim = simulateGoal({ lump: g.currentSaved, monthly: g.monthlyCapacity, months, returnPct: eff, volatilityPct: s.volatilityPct, target });
    // Months needed with current capacity.
    let monthsNeeded: number | null = null;
    for (let m = 1; m <= 600; m++) { if (futureValue(g.currentSaved, g.monthlyCapacity, eff, m, g.annualStepUpPct ?? 0).value >= inflate(g.costToday, g.inflationPct, m / 12)) { monthsNeeded = m; break; } }
    return {
      ...s, effectiveReturnPct: Math.round(eff * 100) / 100, requiredMonthly: req, projectedWithCapacity: fv.value, contributed: fv.contributed,
      shortfall: Math.max(0, target - fv.value), monthsNeededWithCapacity: monthsNeeded, simulated: sim,
    };
  });
  // Return needed to hit the target with current capacity (bisection).
  let lo = -5, hi = 40;
  const fvAt = (r: number) => futureValue(g.currentSaved, g.monthlyCapacity, r, months, g.annualStepUpPct ?? 0).value;
  let requiredReturn: number | null = null;
  if (fvAt(hi) >= target) {
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fvAt(mid) < target) lo = mid; else hi = mid; }
    requiredReturn = Math.round(hi * 100) / 100;
  }
  return { targetFutureCost: target, months, scenarios: scen, requiredReturnPct: requiredReturn };
}

/** Buy a car: save-and-buy vs finance now. Nepal banks cap vehicle loan-to-value (verify current NRB limit). */
export function carPlan(p: { price: number; downPaymentPct: number; loanRatePct: number; loanYears: number; savingsReturnPct: number; carInflationPct: number; monthlyCapacity: number; currentSaved: number; insurancePctPerYear?: number; maxLtvPct?: number }) {
  const ltv = Math.min(100 - p.downPaymentPct, p.maxLtvPct ?? 100);
  const down = p.price * (1 - ltv / 100);
  const loan = p.price - down;
  const e = emi(loan, p.loanRatePct, p.loanYears * 12)!;
  const downGap = Math.max(0, down - p.currentSaved);
  const monthsForDown = (() => {
    for (let m = 0; m <= 360; m++) if (futureValue(p.currentSaved, p.monthlyCapacity, p.savingsReturnPct, m).value >= p.price * (1 - ltv / 100) * Math.pow(1 + p.carInflationPct / 100, m / 12)) return m;
    return null;
  })();
  const monthsForCash = (() => {
    for (let m = 0; m <= 600; m++) if (futureValue(p.currentSaved, p.monthlyCapacity, p.savingsReturnPct, m).value >= p.price * Math.pow(1 + p.carInflationPct / 100, m / 12)) return m;
    return null;
  })();
  const insurance = (p.insurancePctPerYear ?? 1.5) / 100 * p.price;
  return {
    financed: { downPayment: down, loan, emi: e.payment, totalInterest: e.totalInterest, totalCost: down + e.totalPaid, emiShareOfCapacity: p.monthlyCapacity ? e.payment / p.monthlyCapacity : null, downPaymentGap: downGap, monthsToSaveDownPayment: monthsForDown },
    cash: { monthsToSave: monthsForCash, priceAtPurchase: monthsForCash != null ? p.price * Math.pow(1 + p.carInflationPct / 100, monthsForCash / 12) : null },
    yearlyInsuranceEstimate: insurance,
    notes: [
      "NRB sets the maximum loan-to-value for private vehicle loans; check the current directive and your bank's offer.",
      "Running costs (fuel/charging, servicing, tax, insurance) are not included in the loan comparison.",
      "Financing only makes sense if the EMI is comfortably below your monthly surplus (a common rule: under 30-40% of take-home income across all EMIs).",
    ],
  };
}

export function emergencyFund(monthlyEssentialExpenses: number, months = 6, current = 0) {
  const target = monthlyEssentialExpenses * months;
  return { target, gap: Math.max(0, target - current), coveredMonths: monthlyEssentialExpenses ? current / monthlyEssentialExpenses : 0 };
}

export function financialIndependence(annualExpenses: number, withdrawalRatePct = 4, current = 0, monthly = 0, returnPct = 10, inflationPct = 6) {
  const target = annualExpenses / (withdrawalRatePct / 100);
  const real = realReturn(returnPct, inflationPct);
  let months: number | null = null;
  for (let m = 1; m <= 720; m++) if (futureValue(current, monthly, real, m).value >= target) { months = m; break; }
  return { targetInTodaysRs: target, realReturnPct: real, yearsToFI: months != null ? months / 12 : null };
}

export interface AllocationProfile { amount: number; emergencyFundGap: number; highInterestDebt: number; horizonYears: number; risk: "low" | "medium" | "high"; nearTermGoalAmount: number; nearTermGoalYears: number }

/** Rules-based allocation of a lump sum. Priorities: debt > emergency fund > near-term goals > long-term investing. */
export function allocateLumpSum(p: AllocationProfile) {
  let left = p.amount;
  const steps: { bucket: string; amount: number; why: string; vehicles: string[] }[] = [];
  const take = (bucket: string, amt: number, why: string, vehicles: string[]) => {
    const a = Math.max(0, Math.min(left, amt));
    if (a > 0) { steps.push({ bucket, amount: a, why, vehicles }); left -= a; }
  };
  take("Pay off high-interest debt", p.highInterestDebt, "Paying off a loan at 12-18% is a guaranteed, tax-free return that beats most investments.", ["Credit card / personal loan prepayment"]);
  take("Emergency fund", p.emergencyFundGap, "Keep 3-6 months of essential expenses liquid so you never have to sell shares in a downturn.", ["Savings account", "Call deposit", "Short fixed deposit (with premature withdrawal option)"]);
  if (p.nearTermGoalYears <= 3) take("Near-term goal (within 3 years)", p.nearTermGoalAmount, "Money needed within 3 years should not be exposed to equity swings.", ["Fixed deposit matching the goal date", "Debentures", "Government development bonds / savings bonds"]);
  const equityShare = p.risk === "high" ? (p.horizonYears >= 5 ? 0.75 : 0.5) : p.risk === "medium" ? (p.horizonYears >= 5 ? 0.55 : 0.35) : p.horizonYears >= 5 ? 0.3 : 0.15;
  const rest = left;
  take("Equity (long-term growth)", rest * equityShare, `About ${Math.round(equityShare * 100)}% of the remaining long-term money in equity, based on your risk level and ${p.horizonYears}-year horizon.`, ["Diversified NEPSE stocks across 5+ sectors", "Open-ended equity mutual funds (SIP)", "IPOs (lottery-like allotment; small amounts)"]);
  take("Fixed income (stability)", left, "The balance goes to fixed income to dampen volatility and give predictable returns.", ["Fixed deposits", "Debentures", "Government bonds", "Citizen Investment Trust schemes"]);
  return { steps, unallocated: left, equitySharePct: Math.round(equityShare * 100) };
}
