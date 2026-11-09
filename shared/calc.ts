// Money calculators for Nepal. Tax figures follow the Finance Act 2083 (FY 2083/84) as summarised in
// the Inland Revenue Department's official handbook; limits that the handbook did not change are
// passed in so the user can adjust them. Pure functions; tested.

export const TAX_YEAR = "2083/84";
export const TAX_SOURCE = "Inland Revenue Department: Finance Act 2083 information handbook (ird.gov.np)";
/** Resident individual income tax, FY 2083/84 (one table for single and married). */
export const SLABS_2083: { upTo: number | null; rate: number }[] = [
  { upTo: 1_000_000, rate: 0.01 }, { upTo: 1_500_000, rate: 0.10 }, { upTo: 2_500_000, rate: 0.20 }, { upTo: 4_000_000, rate: 0.27 }, { upTo: null, rate: 0.29 },
];

export interface IncomeTaxInput {
  annualIncome: number; // salary incl. allowances and bonus
  retirement: number; // EPF / CIT / SSF / approved retirement fund contributions in the year
  retirementCap: number; // the fixed cap (the deduction is also limited to 1/3 of income)
  lifeInsurance: number; lifeCap: number;
  healthInsurance: number; healthCap: number;
  buildingInsurance: number; // cap Rs. 10,000 from FY 2083/84
  childEducationFees: number; // 25% of fees, max Rs. 25,000 (new in FY 2083/84)
  ssfContributor: boolean; // the 1% social security tax is not charged on SSF contributors
  female: boolean; // 10% rebate on tax (salary income only)
}

export function incomeTax(p: IncomeTaxInput) {
  const inc = Math.max(0, p.annualIncome);
  const ded = {
    retirement: Math.min(p.retirement, inc / 3, p.retirementCap),
    life: Math.min(p.lifeInsurance, p.lifeCap),
    health: Math.min(p.healthInsurance, p.healthCap),
    building: Math.min(p.buildingInsurance, 10_000),
    education: Math.min(p.childEducationFees * 0.25, 25_000),
  };
  const totalDed = Object.values(ded).reduce((a, b) => a + Math.max(0, b), 0);
  const taxable = Math.max(0, inc - totalDed);
  let prev = 0, tax = 0;
  const bands: { from: number; to: number | null; rate: number; amount: number; tax: number }[] = [];
  for (const s of SLABS_2083) {
    const top = s.upTo ?? Infinity, amt = Math.max(0, Math.min(taxable, top) - prev);
    let t = amt * s.rate;
    if (s.rate === 0.01 && p.ssfContributor) t = 0;
    bands.push({ from: prev, to: s.upTo, rate: s.rate, amount: amt, tax: t });
    tax += t; prev = top;
    if (taxable <= top) break;
  }
  const rebate = p.female ? tax * 0.1 : 0;
  const net = tax - rebate;
  return { deductions: ded, totalDeductions: Math.round(totalDed), taxable: Math.round(taxable), bands, taxBeforeRebate: Math.round(tax), rebate: Math.round(rebate), tax: Math.round(net), monthlyTax: Math.round(net / 12), effectivePct: inc ? Math.round((net / inc) * 10000) / 100 : 0, takeHomeMonthly: Math.round((inc - net - p.retirement) / 12) };
}

/** Future value of a monthly SIP that rises by `stepUp` % each year. */
export function stepUpSip(monthly: number, annualPct: number, years: number, stepUpPct = 0) {
  const r = annualPct / 100 / 12; let bal = 0, paid = 0;
  const byYear: { year: number; paid: number; value: number }[] = [];
  for (let m = 0; m < Math.round(years * 12); m++) {
    const amt = monthly * Math.pow(1 + stepUpPct / 100, Math.floor(m / 12));
    bal = (bal + amt) * (1 + r); paid += amt;
    if ((m + 1) % 12 === 0) byYear.push({ year: (m + 1) / 12, paid: Math.round(paid), value: Math.round(bal) });
  }
  return { value: Math.round(bal), paid: Math.round(paid), gain: Math.round(bal - paid), byYear };
}

/** Monthly amount needed to reach a goal (today's money, grown by inflation) by a date. */
export function goalMonthly(goalToday: number, years: number, annualPct: number, inflationPct: number, have = 0) {
  const future = goalToday * Math.pow(1 + inflationPct / 100, years);
  const r = annualPct / 100 / 12, n = Math.round(years * 12);
  const fromHave = have * Math.pow(1 + r, n);
  const need = Math.max(0, future - fromHave);
  const monthly = n <= 0 ? need : r === 0 ? need / n : (need * r) / ((Math.pow(1 + r, n) - 1) * (1 + r));
  return { futureGoal: Math.round(future), monthly: Math.round(monthly), fromSavings: Math.round(fromHave) };
}

export const cagr = (start: number, end: number, years: number) => (start > 0 && end > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : null);
export const doublingYears = (pct: number) => (pct > 0 ? Math.log(2) / Math.log(1 + pct / 100) : null);
/** Return after tax on the gain and after inflation (Fisher). */
export function realReturn(nominalPct: number, taxPct: number, inflationPct: number) {
  const afterTax = nominalPct * (1 - taxPct / 100);
  return { afterTax: Math.round(afterTax * 100) / 100, real: Math.round((((1 + afterTax / 100) / (1 + inflationPct / 100)) - 1) * 10000) / 100 };
}

/** Retirement: the fund needed at retirement and the monthly saving to get there. */
export function retirement(p: { age: number; retireAge: number; lifeTo: number; monthlyExpense: number; inflationPct: number; returnBeforePct: number; returnAfterPct: number; saved: number }) {
  const yrs = Math.max(0, p.retireAge - p.age), yrsIn = Math.max(1, p.lifeTo - p.retireAge);
  const expAtRetire = p.monthlyExpense * Math.pow(1 + p.inflationPct / 100, yrs) * 12;
  const real = (1 + p.returnAfterPct / 100) / (1 + p.inflationPct / 100) - 1;
  const corpus = real === 0 ? expAtRetire * yrsIn : expAtRetire * (1 - Math.pow(1 + real, -yrsIn)) / real * (1 + real);
  const g = goalMonthly(corpus, yrs, p.returnBeforePct, 0, p.saved);
  return { yearsToRetire: yrs, yearlyExpenseAtRetirement: Math.round(expAtRetire), corpus: Math.round(corpus), monthlySaving: g.monthly, savedGrowsTo: g.fromSavings };
}

/** New average price after buying more shares. */
export function averagePrice(holdQty: number, holdAvg: number, buyQty: number, buyPrice: number) {
  const q = holdQty + buyQty;
  return { qty: q, avg: q ? Math.round(((holdQty * holdAvg + buyQty * buyPrice) / q) * 100) / 100 : 0, invested: Math.round(holdQty * holdAvg + buyQty * buyPrice) };
}
/** Price after a bonus issue and/or right issue (ratio as % of holding). */
export function adjustedPrice(price: number, bonusPct: number, rightPct: number, rightPrice = 100) {
  const afterBonus = price / (1 + bonusPct / 100);
  const afterRight = (afterBonus + (rightPct / 100) * rightPrice) / (1 + rightPct / 100);
  return { afterBonus: Math.round(afterBonus * 100) / 100, afterRight: Math.round(afterRight * 100) / 100 };
}
/** Yield to maturity of a bond/debenture bought at `price` (annual coupons), before and after tax on interest. */
export function ytm(price: number, face: number, couponPct: number, years: number, taxPct = 0) {
  const solve = (cpn: number) => {
    let lo = -0.5, hi = 1;
    const pv = (y: number) => { let v = 0; for (let t = 1; t <= Math.ceil(years); t++) v += cpn / Math.pow(1 + y, t); return v + face / Math.pow(1 + y, years); };
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (pv(mid) > price) lo = mid; else hi = mid; }
    return Math.round(((lo + hi) / 2) * 10000) / 100;
  };
  const c = face * couponPct / 100;
  return { ytm: solve(c), afterTax: solve(c * (1 - taxPct / 100)), currentYield: Math.round((c / price) * 10000) / 100 };
}
/** Rent vs buy after N years: net worth from owning vs renting and investing the difference. */
export function rentVsBuy(p: { price: number; downPct: number; loanRatePct: number; loanYears: number; rentMonthly: number; rentGrowthPct: number; homeGrowthPct: number; investPct: number; years: number; buyCostPct: number }) {
  const down = p.price * p.downPct / 100, loan = p.price - down;
  const r = p.loanRatePct / 100 / 12, n = p.loanYears * 12;
  const emi = r === 0 ? loan / n : (loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  let bal = loan, invest = down + p.price * p.buyCostPct / 100, rent = p.rentMonthly;
  const mi = p.investPct / 100 / 12;
  for (let m = 0; m < p.years * 12; m++) {
    if (m > 0 && m % 12 === 0) rent *= 1 + p.rentGrowthPct / 100;
    const pay = m < n ? emi : 0;
    if (m < n) bal = bal * (1 + r) - emi;
    invest = invest * (1 + mi) + Math.max(0, pay - rent); // the renter invests what the owner pays above rent
  }
  const home = p.price * Math.pow(1 + p.homeGrowthPct / 100, p.years);
  const own = home - Math.max(0, bal);
  return { emi: Math.round(emi), ownNetWorth: Math.round(own), rentNetWorth: Math.round(invest), better: own >= invest ? "buy" as const : "rent" as const };
}
/** How big a home loan an income can carry (banks cap total EMIs at a share of income). */
export function loanAffordability(monthlyIncome: number, otherEmi: number, ratePct: number, years: number, maxDtiPct = 50) {
  const room = Math.max(0, monthlyIncome * maxDtiPct / 100 - otherEmi);
  const r = ratePct / 100 / 12, n = years * 12;
  const loan = r === 0 ? room * n : room * (1 - Math.pow(1 + r, -n)) / r;
  return { maxEmi: Math.round(room), maxLoan: Math.round(loan) };
}
/** Cost of buying gold and the price rise needed to break even on resale. */
export function goldCost(p: { tola: number; ratePerTola: number; makingPerTola: number; skillFeePct: number; buybackDiscountPct: number }) {
  const metal = p.tola * p.ratePerTola, making = p.tola * p.makingPerTola, fee = (metal + making) * p.skillFeePct / 100;
  const total = metal + making + fee, resale = metal * (1 - p.buybackDiscountPct / 100);
  return { metal: Math.round(metal), making: Math.round(making), fee: Math.round(fee), total: Math.round(total), resaleToday: Math.round(resale), breakEvenRisePct: resale ? Math.round(((total / resale) - 1) * 10000) / 100 : null };
}
