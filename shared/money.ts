// Personal money engine: cash flow, net worth, savings advice, allocation of a lump sum or a
// monthly amount, loan-vs-invest and deposit comparison. Pure and deterministic (tested in
// tests/money.test.ts). Rates come from the caller (NRB data, your verified deposit rates), so
// nothing here invents a return. Guaranteed (contractual) and market-linked returns stay separate.

export type AccountType = "bank" | "cash" | "fd" | "stocks" | "mutual_fund" | "bond" | "debenture" | "pf" | "cit" | "ssf" | "insurance" | "gold" | "property" | "receivable" | "other";
export type LiabilityType = "home" | "car" | "personal" | "education" | "credit_card" | "business" | "family" | "other";
export type Risk = "low" | "medium" | "high";

export interface Account { id: string; name: string; type: AccountType; institution?: string; balance: number; ratePct?: number | null; maturity?: string | null }
export interface Liability { id: string; name: string; type: LiabilityType; balance: number; ratePct: number; emi: number; monthsLeft?: number | null }
export interface CashLine { id: string; label: string; amount: number; essential?: boolean; category?: string }
export interface MoneyData {
  income: CashLine[]; // monthly, NPR
  expenses: CashLine[]; // monthly, NPR (EMIs are in liabilities, not here)
  accounts: Account[];
  liabilities: Liability[];
  risk: Risk;
  horizonYears: number;
  emergencyMonths: number;
  savingsTarget?: number; // monthly
  history?: { month: string; netWorth: number; assets: number; liabilities: number }[]; // one point per month, recorded on save
}
export const EMPTY_MONEY: MoneyData = { income: [], expenses: [], accounts: [], liabilities: [], risk: "medium", horizonYears: 5, emergencyMonths: 6, savingsTarget: 0, history: [] };

export interface MarketRates {
  fdPct: number | null; // a fixed-deposit rate you can actually get (best verified, else NRB average)
  savingPct: number | null; // savings account rate (NRB average)
  tbillPct: number | null; // 364-day T-bill
  inflationPct: number | null; // NRB CPI y-o-y
  equityLongRunPct: number | null; // NEPSE index long-run annual growth (price only)
  goldPct?: number | null; silverPct?: number | null; // FENEGOSIDA long-run growth per tola (planning rate)
  interestTaxPct: number; // TDS on interest for individuals
}

/** How each account type behaves: guaranteed (contractual), market-linked, or long-term/illiquid. */
export const CLASS: Record<AccountType, { label: string; kind: "guaranteed" | "market" | "illiquid" | "cash"; liquid: boolean }> = {
  bank: { label: "Bank savings", kind: "cash", liquid: true }, cash: { label: "Cash", kind: "cash", liquid: true },
  fd: { label: "Fixed deposits", kind: "guaranteed", liquid: false }, bond: { label: "Government bonds", kind: "guaranteed", liquid: false },
  debenture: { label: "Debentures", kind: "guaranteed", liquid: false }, stocks: { label: "NEPSE shares", kind: "market", liquid: true },
  mutual_fund: { label: "Mutual funds", kind: "market", liquid: true }, pf: { label: "Provident fund", kind: "illiquid", liquid: false },
  cit: { label: "Citizen Investment Trust", kind: "illiquid", liquid: false }, ssf: { label: "Social Security Fund", kind: "illiquid", liquid: false },
  insurance: { label: "Insurance (surrender value)", kind: "illiquid", liquid: false }, gold: { label: "Gold / silver", kind: "market", liquid: true },
  property: { label: "Property / land", kind: "illiquid", liquid: false }, receivable: { label: "Money lent to others", kind: "illiquid", liquid: false },
  other: { label: "Other", kind: "illiquid", liquid: false },
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface MoneySummary {
  income: number; expenses: number; essential: number; emi: number; cashFlow: number; savingsRatePct: number | null;
  assets: number; liabilities: number; netWorth: number;
  allocation: { type: AccountType; label: string; kind: string; value: number; pct: number }[];
  byKind: Record<"cash" | "guaranteed" | "market" | "illiquid", number>;
  liquid: number; emergencyTarget: number; emergencyCovered: number; emergencyMonthsCovered: number | null; emergencyGap: number;
  debtServicePct: number | null; weightedDebtRatePct: number | null; idleCash: number; equityPct: number | null;
}

export function summarize(d: MoneyData, extra: { portfolioValue?: number } = {}): MoneySummary {
  const income = sum(d.income.map((x) => x.amount));
  const expenses = sum(d.expenses.map((x) => x.amount));
  const essential = sum(d.expenses.filter((x) => x.essential !== false).map((x) => x.amount));
  const emi = sum(d.liabilities.map((l) => l.emi));
  const cashFlow = income - expenses - emi;
  const accounts = [...d.accounts];
  // Holdings tracked in the Portfolio page count as shares unless you already entered a stocks account.
  if (extra.portfolioValue && !accounts.some((a) => a.type === "stocks")) accounts.push({ id: "portfolio", name: "Portfolio (from Saphal Stocks)", type: "stocks", balance: extra.portfolioValue });
  const assets = sum(accounts.map((a) => a.balance));
  const liabilities = sum(d.liabilities.map((l) => l.balance));
  const byType = new Map<AccountType, number>();
  for (const a of accounts) byType.set(a.type, (byType.get(a.type) ?? 0) + (a.balance || 0));
  const allocation = [...byType.entries()].filter(([, v]) => v > 0).map(([type, value]) => ({ type, label: CLASS[type].label, kind: CLASS[type].kind, value, pct: assets ? r1((value / assets) * 100) : 0 })).sort((a, b) => b.value - a.value);
  const byKind = { cash: 0, guaranteed: 0, market: 0, illiquid: 0 };
  for (const a of allocation) byKind[a.kind as keyof typeof byKind] += a.value;
  const cash = byKind.cash;
  const liquidFd = sum(accounts.filter((a) => a.type === "fd").map((a) => a.balance));
  const emergencyTarget = (essential || expenses) * d.emergencyMonths + emi * Math.min(d.emergencyMonths, 3);
  // Cash counts fully; FDs can usually be broken early (with a penalty), so they count as a backup.
  const emergencyCovered = cash + Math.min(liquidFd, Math.max(0, emergencyTarget - cash)) * 0.9;
  const monthlyNeed = (essential || expenses) + emi;
  const debtRates = d.liabilities.filter((l) => l.balance > 0);
  const weightedDebtRatePct = debtRates.length ? r1(sum(debtRates.map((l) => l.balance * l.ratePct)) / sum(debtRates.map((l) => l.balance))) : null;
  const investable = byKind.cash + byKind.guaranteed + byKind.market;
  return {
    income, expenses, essential, emi, cashFlow, savingsRatePct: income ? r1((cashFlow / income) * 100) : null,
    assets, liabilities, netWorth: assets - liabilities, allocation, byKind,
    liquid: cash + byKind.market, emergencyTarget: r0(emergencyTarget), emergencyCovered: r0(emergencyCovered),
    emergencyMonthsCovered: monthlyNeed ? r1(emergencyCovered / monthlyNeed) : null, emergencyGap: r0(Math.max(0, emergencyTarget - emergencyCovered)),
    debtServicePct: income ? r1((emi / income) * 100) : null, weightedDebtRatePct,
    idleCash: r0(Math.max(0, cash - Math.max(emergencyTarget, monthlyNeed) * 1.15)),
    equityPct: investable ? r1((byKind.market / investable) * 100) : null,
  };
}

export interface Advice { priority: 1 | 2 | 3; area: "cash flow" | "emergency" | "debt" | "spending" | "idle cash" | "investing" | "inflation" | "protection"; title: string; detail: string; amount?: number; yearlyImpact?: number }

/** Spending categories and the share of take-home income above which they deserve a look. */
const BENCHMARKS: Record<string, { label: string; maxPct: number }> = {
  housing: { label: "Rent / housing", maxPct: 30 }, food: { label: "Groceries / food", maxPct: 20 }, transport: { label: "Transport / fuel", maxPct: 12 },
  dining: { label: "Eating out / entertainment", maxPct: 8 }, shopping: { label: "Shopping / clothes", maxPct: 8 }, subscriptions: { label: "Phone, internet, subscriptions", maxPct: 5 },
  travel: { label: "Travel / holidays", maxPct: 8 }, other: { label: "Other", maxPct: 10 },
};
export const EXPENSE_CATEGORIES = Object.entries(BENCHMARKS).map(([key, v]) => ({ key, label: v.label })).concat([
  { key: "utilities", label: "Electricity, water, gas" }, { key: "education", label: "School / education" }, { key: "health", label: "Health / medicine" },
  { key: "insurance", label: "Insurance premiums" }, { key: "family", label: "Family support" }, { key: "social", label: "Festivals, gifts, social" },
]);

export function savingsAdvice(d: MoneyData, s: MoneySummary, rates: MarketRates): Advice[] {
  const out: Advice[] = [];
  const tax = rates.interestTaxPct / 100;
  const fdNet = rates.fdPct != null ? rates.fdPct * (1 - tax) : null;
  if (s.income > 0 && s.cashFlow < 0) out.push({ priority: 1, area: "cash flow", title: `You spend Rs. ${fmt(-s.cashFlow)} more than you earn each month`, detail: "Fix this before investing: cut the largest non-essential lines below, or restructure loans to lower the EMI.", amount: -s.cashFlow });
  // Expensive debt first: a loan's interest is a guaranteed cost, investments are not guaranteed.
  const hurdle = Math.max(fdNet ?? 0, 0) + 2;
  for (const l of [...d.liabilities].filter((x) => x.balance > 0).sort((a, b) => b.ratePct - a.ratePct)) {
    if (l.type === "credit_card" || l.ratePct >= Math.max(11, hurdle + 4)) {
      out.push({ priority: 1, area: "debt", title: `Pay down ${l.name} (${l.ratePct}% interest) before investing`, detail: `Every rupee repaid saves ${l.ratePct}% a year, guaranteed. ${fdNet != null ? `An FD earns about ${fdNet.toFixed(2)}% after tax.` : ""}`, amount: l.balance, yearlyImpact: r0(l.balance * l.ratePct / 100) });
    }
  }
  if (s.emergencyGap > 0) out.push({ priority: 1, area: "emergency", title: `Build your emergency fund: Rs. ${fmt(s.emergencyGap)} short of ${d.emergencyMonths} months`, detail: `Target Rs. ${fmt(s.emergencyTarget)} (${d.emergencyMonths} months of essential costs${s.emi ? " plus 3 months of EMIs" : ""}). Keep it in a savings or call account, or a short FD you can break.${s.cashFlow > 0 ? ` At Rs. ${fmt(Math.round(s.cashFlow * 0.5))}/month (half your surplus) it takes ${Math.ceil(s.emergencyGap / Math.max(1, s.cashFlow * 0.5))} months.` : ""}`, amount: s.emergencyGap });
  if (s.debtServicePct != null && s.debtServicePct > 40) out.push({ priority: 1, area: "debt", title: `EMIs take ${s.debtServicePct}% of your income`, detail: "Above 40% leaves little room for shocks. Avoid new loans; prepay the highest-rate loan when you can." });
  // Spending against benchmarks
  if (s.income > 0) {
    const byCat = new Map<string, number>();
    for (const e of d.expenses) byCat.set(e.category || "other", (byCat.get(e.category || "other") ?? 0) + e.amount);
    for (const [cat, amt] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
      const b = BENCHMARKS[cat];
      if (!b) continue;
      const pctInc = (amt / s.income) * 100;
      if (pctInc > b.maxPct) {
        const cut = r0(amt - (s.income * b.maxPct) / 100);
        out.push({ priority: 2, area: "spending", title: `${b.label}: ${r1(pctInc)}% of income (guide: up to ${b.maxPct}%)`, detail: `Bringing it to ${b.maxPct}% frees Rs. ${fmt(cut)} a month${fdNet != null ? `, Rs. ${fmt(r0(futureMonthly(cut, fdNet, 60)))} in 5 years even at FD rates` : ""}.`, amount: cut, yearlyImpact: cut * 12 });
      }
    }
    const nonEss = d.expenses.filter((e) => e.essential === false).sort((a, b) => b.amount - a.amount);
    if (s.savingsRatePct != null && s.savingsRatePct < 20 && nonEss.length) {
      const top = nonEss.slice(0, 3);
      const cut = r0(sum(top.map((e) => e.amount)) * 0.2);
      out.push({ priority: 2, area: "spending", title: `Savings rate ${s.savingsRatePct}%: aim for at least 20%`, detail: `Trimming 20% from ${top.map((e) => e.label).join(", ")} saves Rs. ${fmt(cut)} a month (Rs. ${fmt(cut * 12)} a year).`, amount: cut, yearlyImpact: cut * 12 });
    }
  }
  // Idle cash earning savings-account interest
  if (s.idleCash > 50_000 && rates.fdPct != null && rates.savingPct != null && rates.fdPct > rates.savingPct) {
    const gain = r0(s.idleCash * (rates.fdPct - rates.savingPct) / 100 * (1 - tax));
    out.push({ priority: 2, area: "idle cash", title: `Rs. ${fmt(s.idleCash)} is sitting in savings beyond your emergency fund`, detail: `Moving it to a fixed deposit (about ${rates.fdPct}% vs ${rates.savingPct}% in savings) earns about Rs. ${fmt(gain)} more a year after tax, or invest it toward your goals.`, amount: s.idleCash, yearlyImpact: gain });
  }
  if (fdNet != null && rates.inflationPct != null && fdNet < rates.inflationPct && (s.byKind.guaranteed + s.byKind.cash) > 0) {
    out.push({ priority: 3, area: "inflation", title: `Deposits are losing to inflation (${fdNet.toFixed(2)}% after tax vs ${rates.inflationPct}% inflation)`, detail: rates.equityLongRunPct != null && rates.equityLongRunPct > rates.inflationPct + 1
      ? `Fine for safety money and near-term goals. For goals five or more years away, NEPSE returned about ${rates.equityLongRunPct.toFixed(1)}% a year (with dividends) over the last decade, above inflation, but with large falls along the way.`
      : `Fine for safety money and near-term goals. Note that NEPSE also returned only about ${rates.equityLongRunPct != null ? rates.equityLongRunPct.toFixed(1) : "—"}% a year (with dividends) over the last decade, so no option reliably beats inflation; match each rupee to its time horizon, pick the best verified deposit rate, and keep costs low.` });
  }
  const cap = equityCap(d.risk, d.horizonYears);
  if (d.accounts.some((a) => a.type !== "stocks") && s.equityPct != null && s.equityPct > cap + 10) out.push({ priority: 2, area: "investing", title: `Shares are ${s.equityPct}% of your investable money (your guide: about ${cap}%)`, detail: "Consider taking some profits into fixed income so a market fall does not derail near-term plans." });
  if (s.cashFlow > 0 && s.emergencyGap === 0 && !out.some((a) => a.area === "debt" && a.priority === 1)) out.push({ priority: 3, area: "investing", title: `Invest your monthly surplus of Rs. ${fmt(s.cashFlow)}`, detail: "Use the Where to invest page for a split that matches your risk, goals and current rates." });
  if (!d.accounts.some((a) => a.type === "insurance") && d.liabilities.some((l) => l.balance > 0)) out.push({ priority: 3, area: "protection", title: "Check you have term life and health cover", detail: "With loans outstanding, term life cover (not savings-linked policies) protects your family from the debt." });
  return out.sort((a, b) => a.priority - b.priority);
}

/** Future value of a monthly amount at an annual rate (monthly compounding). */
export function futureMonthly(monthly: number, annualPct: number, months: number) {
  const r = annualPct / 100 / 12;
  return r === 0 ? monthly * months : monthly * ((Math.pow(1 + r, months) - 1) / r);
}
export const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Share of long-term money that can go to market-linked investments. Never 100%. */
export function equityCap(risk: Risk, horizonYears: number) {
  const base = risk === "high" ? 60 : risk === "medium" ? 40 : 15;
  const h = horizonYears < 3 ? 0.25 : horizonYears < 5 ? 0.7 : horizonYears >= 10 ? 1.15 : 1;
  return Math.min(70, Math.round(base * h));
}

export interface AllocationInput {
  amount: number; monthly?: number; risk: Risk; horizonYears: number;
  emergencyGap: number; expensiveDebt: { name: string; balance: number; ratePct: number }[];
  nearTermNeeds: { name: string; amount: number; years: number }[]; // goals within 3 years
  existingEquityPct?: number | null;
  rates: MarketRates;
}
export interface Bucket { name: string; amount: number; kind: "safety" | "debt" | "guaranteed" | "market"; returnText: string; expectedPct: { low: number; mid: number; high: number } | null; guaranteed: boolean; why: string; options: string[] }

/** Splits a lump sum (and optionally a monthly amount) by priority: debt, safety, near-term goals, then long-term growth. */
export function adviseAllocation(p: AllocationInput) {
  const tax = p.rates.interestTaxPct / 100;
  const fd = p.rates.fdPct, fdNet = fd != null ? fd * (1 - tax) : null;
  const eq = p.rates.equityLongRunPct;
  const buckets: Bucket[] = [];
  let left = p.amount;
  const take = (b: Omit<Bucket, "amount">, want: number) => { const a = Math.max(0, Math.min(left, want)); if (a > 0) { buckets.push({ ...b, amount: r0(a) }); left -= a; } };
  for (const d of [...p.expensiveDebt].sort((a, b) => b.ratePct - a.ratePct)) {
    take({ name: `Repay ${d.name}`, kind: "debt", guaranteed: true, returnText: `Saves ${d.ratePct}% a year (guaranteed, tax-free)`, expectedPct: { low: d.ratePct, mid: d.ratePct, high: d.ratePct }, why: `A ${d.ratePct}% loan costs more than deposits pay after tax${fdNet != null ? ` (${fdNet.toFixed(2)}%)` : ""}.`, options: ["Prepay principal (ask the bank about prepayment fees)"] }, d.balance);
  }
  const savNet = p.rates.savingPct != null ? p.rates.savingPct * (1 - tax) : null;
  take({ name: "Emergency fund", kind: "safety", guaranteed: true, returnText: savNet != null ? `About ${savNet.toFixed(2)}% after tax (savings account)` : "Savings-account interest", expectedPct: savNet != null ? { low: savNet, mid: savNet, high: savNet } : null, why: "Instant access for job loss, health or family emergencies, so you never sell investments at a bad time.", options: ["Savings or call account", "Short FD that allows early withdrawal"] }, p.emergencyGap);
  for (const g of p.nearTermNeeds.filter((x) => x.years <= 3)) {
    take({ name: `${g.name} (in ${g.years} yr)`, kind: "guaranteed", guaranteed: true, returnText: fdNet != null ? `About ${fdNet.toFixed(2)}% after tax (FD matched to the date)` : "Fixed-deposit interest", expectedPct: fdNet != null ? { low: fdNet, mid: fdNet, high: fdNet } : null, why: "Money needed within 3 years should not be exposed to share-price swings.", options: ["Fixed deposit maturing before the goal date", "Treasury bills (via banks)", "Listed debentures maturing before the date"] }, g.amount);
  }
  const rest = left;
  let cap = equityCap(p.risk, p.horizonYears);
  // If you already hold a lot of shares, new money leans to fixed income to bring the mix back.
  if (p.existingEquityPct != null && p.existingEquityPct > cap) cap = Math.max(0, cap - Math.min(cap, (p.existingEquityPct - cap)));
  const eqAmt = rest * cap / 100;
  const giAmt = rest - eqAmt;
  if (giAmt > 0) take({ name: "Fixed income (stability)", kind: "guaranteed", guaranteed: true, returnText: fdNet != null ? `About ${fdNet.toFixed(2)}% after tax, contractual` : "Contractual interest", expectedPct: fdNet != null ? { low: fdNet, mid: fdNet, high: fdNet } : null, why: `${100 - cap}% of long-term money in fixed income keeps the plan steady${p.rates.inflationPct != null && fdNet != null && fdNet < p.rates.inflationPct ? `, though at ${p.rates.inflationPct}% inflation it barely keeps value` : ""}.`, options: ["Highest verified FD rate (see Deposit rates)", "Listed debentures (check coupon and maturity)", "Government development / savings bonds when issued", "CIT schemes for long-term, tax-advantaged saving"] }, giAmt);
  if (eqAmt > 0) take({ name: "Long-term growth (market-linked)", kind: "market", guaranteed: false, returnText: eq != null ? `About ${eq.toFixed(1)}% a year over the last 10 years including dividends (NEPSE), with years of large losses` : "Can be negative", expectedPct: eq != null ? { low: -20, mid: eq, high: eq + 10 } : null, why: `${cap}% of long-term money for growth, based on your ${p.risk} risk level and ${p.horizonYears}-year horizon. Never all of it: a 30-50% fall in NEPSE has happened before.`, options: ["Open-ended or closed-end mutual funds (diversified)", "5+ fundamentally strong stocks across sectors (see Stocks, Fundamentals)", "SIP in mutual funds each month", "IPOs in small amounts"] }, eqAmt);
  const projection = (years: number) => {
    let low = 0, mid = 0, high = 0;
    for (const b of buckets) {
      if (!b.expectedPct) { low += b.amount; mid += b.amount; high += b.amount; continue; }
      if (b.kind === "debt") { const saved = b.amount * Math.pow(1 + b.expectedPct.mid / 100, years); low += saved; mid += saved; high += saved; continue; }
      low += b.amount * Math.pow(1 + (b.guaranteed ? b.expectedPct.low : Math.max(-5, (b.expectedPct.mid - 8))) / 100, years);
      mid += b.amount * Math.pow(1 + b.expectedPct.mid / 100, years);
      high += b.amount * Math.pow(1 + b.expectedPct.high / 100, years);
    }
    return { years, low: r0(low), mid: r0(mid), high: r0(high) };
  };
  const monthlySplit = p.monthly ? buckets.filter((b) => b.kind === "guaranteed" || b.kind === "market").length
    ? [{ name: "Fixed income", amount: r0(p.monthly * (100 - cap) / 100) }, { name: "Market-linked (SIP)", amount: r0(p.monthly * cap / 100) }]
    : [{ name: "Emergency fund / debt first", amount: r0(p.monthly) }] : [];
  const guaranteedPct = p.amount ? r1(sum(buckets.filter((b) => b.guaranteed).map((b) => b.amount)) / p.amount * 100) : 0;
  return { buckets, unallocated: r0(left), equityCapPct: cap, guaranteedPct, projections: [projection(1), projection(Math.max(1, Math.round(p.horizonYears)))], monthlySplit };
}

/** Prepay a loan or invest the same money? Compares interest saved with after-tax investment growth. */
export function loanVsInvest(p: { amount: number; loanRatePct: number; years: number; investReturnPct: number; investGuaranteed: boolean }) {
  const saved = p.amount * (Math.pow(1 + p.loanRatePct / 100, p.years) - 1);
  const earned = p.amount * (Math.pow(1 + p.investReturnPct / 100, p.years) - 1);
  const prepay = p.loanRatePct >= p.investReturnPct || (!p.investGuaranteed && p.loanRatePct >= p.investReturnPct - 3);
  return {
    interestSaved: r0(saved), investGain: r0(earned), better: prepay ? "prepay" as const : "invest" as const,
    why: prepay
      ? `Prepaying saves ${p.loanRatePct}% a year with certainty; investing would need to beat that ${p.investGuaranteed ? "" : "after taking market risk "}to be worth it.`
      : `The investment's expected ${p.investReturnPct}% a year beats the loan's ${p.loanRatePct}%${p.investGuaranteed ? " and is contractual" : ", but it is not guaranteed; keep the emergency fund intact first"}.`,
  };
}

export interface DepositOffer { institution: string; instType?: string | null; product?: string | null; tenorMonths?: number | null; ratePct: number; sourceUrl?: string | null; effectiveFrom?: string | null; method?: string | null }
/** Ranks deposit offers by after-tax maturity for an amount and term. */
export function compareDeposits(offers: DepositOffer[], amount: number, months: number, taxPct: number, inflationPct: number | null) {
  return offers.filter((o) => o.ratePct > 0 && (o.tenorMonths == null || Math.abs(o.tenorMonths - months) <= Math.max(2, months * 0.25))).map((o) => {
    const q = Math.max(1, Math.round(months / 3)); // quarterly compounding, the usual practice
    const r = o.ratePct / 100 / 4;
    let bal = amount;
    for (let i = 0; i < q; i++) bal += bal * r * (1 - taxPct / 100);
    const net = bal - amount;
    const netPct = ((Math.pow(bal / amount, 12 / months) - 1) * 100);
    return { ...o, maturity: r0(bal), interestNet: r0(net), netAnnualPct: Math.round(netPct * 100) / 100, realPct: inflationPct != null ? Math.round((netPct - inflationPct) * 100) / 100 : null };
  }).sort((a, b) => b.maturity - a.maturity);
}

/** Debenture name like "10.50% Century Debenture 2088" -> coupon and maturity (BS year), with simple yields. */
export function debentureYield(name: string, price: number | null, todayIso: string, face = 1000) {
  const coupon = Number(name.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
  const bs = Number(name.match(/(20\d{2})\s*$/)?.[1]);
  if (!Number.isFinite(coupon) || !Number.isFinite(bs)) return null;
  const maturityYearAd = bs - 57; // BS to AD, approximately (BS year starts mid-April)
  const years = Math.max(0.1, maturityYearAd + 0.5 - (Number(todayIso.slice(0, 4)) + Number(todayIso.slice(5, 7)) / 12));
  const currentYield = price ? (coupon * face) / 100 / price * 100 : null;
  const ytm = price ? ((coupon * face / 100) + (face - price) / years) / ((face + price) / 2) * 100 : null;
  return { couponPct: coupon, maturityBs: bs, yearsLeft: r1(years), currentYieldPct: currentYield != null ? Math.round(currentYield * 100) / 100 : null, approxYtmPct: ytm != null ? Math.round(ytm * 100) / 100 : null };
}

/** Annualised growth between two values over a number of years. */
export const cagr = (start: number, end: number, years: number) => (start > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : null);

/** Goal-planner scenarios from current data instead of fixed assumptions. Falls back to null when rates are missing. */
export function scenariosFromRates(r: Pick<MarketRates, "fdPct" | "equityLongRunPct">) {
  if (r.fdPct == null || r.equityLongRunPct == null) return null;
  const fd = r.fdPct, eq = r.equityLongRunPct;
  const mix = (w: number) => Math.round((fd * (1 - w) + eq * w) * 100) / 100;
  return [
    { name: "Conservative" as const, returnPct: fd, volatilityPct: 1, description: `Fixed deposits / bonds at about ${fd}% (contractual).` },
    { name: "Moderate" as const, returnPct: mix(0.4), volatilityPct: 8, description: `60% fixed income, 40% NEPSE-like equity (equity ${eq}% a year over the last decade, not guaranteed).` },
    { name: "Aggressive" as const, returnPct: mix(0.7), volatilityPct: 18, description: `30% fixed income, 70% equity; large swings likely.` },
  ];
}

// ---------- income & expense tracker ----------
export const ENTRY_CATEGORIES = {
  expense: [
    { key: "food", label: "Food & groceries", budget: "food" }, { key: "housing", label: "Rent / housing", budget: "housing" }, { key: "transport", label: "Transport / fuel", budget: "transport" },
    { key: "utilities", label: "Electricity, water, gas", budget: "utilities" }, { key: "subscriptions", label: "Phone, internet, subscriptions", budget: "subscriptions" },
    { key: "dining", label: "Eating out / entertainment", budget: "dining" }, { key: "shopping", label: "Shopping / clothes", budget: "shopping" }, { key: "health", label: "Health / medicine", budget: "health" },
    { key: "education", label: "School / education", budget: "education" }, { key: "insurance", label: "Insurance premiums", budget: "insurance" }, { key: "family", label: "Family support", budget: "family" },
    { key: "social", label: "Festivals, gifts, social", budget: "social" }, { key: "travel", label: "Travel / holidays", budget: "travel" }, { key: "emi", label: "Loan EMI", budget: null },
    { key: "invest", label: "Saved / invested", budget: null }, { key: "other", label: "Other", budget: "other" },
  ],
  income: [
    { key: "salary", label: "Salary" }, { key: "business", label: "Business / professional" }, { key: "rent", label: "Rent received" }, { key: "dividend", label: "Dividends" },
    { key: "interest", label: "Interest" }, { key: "freelance", label: "Freelance / side income" }, { key: "gift", label: "Gift / remittance received" }, { key: "other_income", label: "Other" },
  ],
} as const;
export const PAY_METHODS = ["Cash", "Bank", "Card", "eSewa", "Khalti", "Fonepay", "Other"];

export interface Entry { id?: number; date: string; type: "income" | "expense"; category: string; amount: number; note?: string | null; method?: string | null }

/** Month summary: totals, by category, by day; "invest" and EMI are shown separately from spending. */
export function summarizeEntries(entries: Entry[]) {
  const income = sum(entries.filter((e) => e.type === "income").map((e) => e.amount));
  const exp = entries.filter((e) => e.type === "expense");
  const invested = sum(exp.filter((e) => e.category === "invest").map((e) => e.amount));
  const emi = sum(exp.filter((e) => e.category === "emi").map((e) => e.amount));
  const spending = sum(exp.filter((e) => e.category !== "invest").map((e) => e.amount));
  const byCat = new Map<string, number>();
  for (const e of entries) byCat.set(`${e.type}:${e.category}`, (byCat.get(`${e.type}:${e.category}`) ?? 0) + e.amount);
  const byDay = new Map<string, { income: number; expense: number }>();
  for (const e of entries) { const d = byDay.get(e.date) ?? { income: 0, expense: 0 }; if (e.type === "income") d.income += e.amount; else d.expense += e.amount; byDay.set(e.date, d); }
  return {
    income, spending, invested, emi, net: income - spending,
    savingsRatePct: income ? r1(((income - spending) / income) * 100) : null,
    categories: [...byCat.entries()].map(([k, v]) => ({ type: k.split(":")[0] as "income" | "expense", category: k.split(":")[1], amount: v })).sort((a, b) => b.amount - a.amount),
    days: [...byDay.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

/** Average monthly spending per budget category over full months, to fill My Money's expense list. */
export function averageMonthly(entries: Entry[], months: string[]) {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "expense" || !months.includes(e.date.slice(0, 7))) continue;
    out.set(e.category, (out.get(e.category) ?? 0) + e.amount / months.length);
  }
  return [...out.entries()].map(([category, amount]) => ({ category, amount: r0(amount) }));
}

// ---------- debt payoff planner ----------
/** Month-by-month payoff of all loans paying each EMI plus an extra amount, aimed at one loan at a time
 *  ("avalanche": highest rate first, saves the most interest; "snowball": smallest balance first). */
export function debtPlan(loans: Liability[], extraMonthly: number, method: "avalanche" | "snowball") {
  const ls = loans.filter((l) => l.balance > 0).map((l) => ({ ...l, bal: l.balance, paidOff: null as number | null, interest: 0 }));
  if (!ls.length) return null;
  const order = [...ls].sort((a, b) => (method === "avalanche" ? b.ratePct - a.ratePct : a.bal - b.bal)).map((l) => l.id);
  let month = 0, totalInterest = 0;
  while (ls.some((l) => l.bal > 0.5) && month < 600) {
    month++;
    let extra = extraMonthly;
    for (const l of ls) {
      if (l.bal <= 0.5) { extra += l.emi; continue; } // freed EMI rolls into the next loan
      const int = l.bal * l.ratePct / 100 / 12;
      l.interest += int; totalInterest += int;
      const pay = Math.min(l.bal + int, Math.max(l.emi, int + 1));
      l.bal = l.bal + int - pay;
    }
    for (const id of order) {
      const l = ls.find((x) => x.id === id)!;
      if (l.bal <= 0.5 || extra <= 0) continue;
      const p = Math.min(extra, l.bal); l.bal -= p; extra -= p;
    }
    for (const l of ls) if (l.bal <= 0.5 && l.paidOff == null) l.paidOff = month;
  }
  if (month >= 600) return { feasible: false as const, method };
  return { feasible: true as const, method, months: month, totalInterest: r0(totalInterest), order: order.map((id) => { const l = ls.find((x) => x.id === id)!; return { id, name: l.name, ratePct: l.ratePct, balance: l.balance, paidOffMonth: l.paidOff, interest: r0(l.interest) }; }) };
}

/** Three portfolios for an amount, compared on return, risk, liquidity, protection and access. */
export function compareProfiles(amount: number, rates: MarketRates) {
  const tax = rates.interestTaxPct / 100;
  const fd = rates.fdPct != null ? rates.fdPct * (1 - tax) : null;
  const sav = rates.savingPct != null ? rates.savingPct * (1 - tax) : null;
  const eq = rates.equityLongRunPct;
  const mk = (name: string, why: string, parts: { option: string; pct: number; rate: number | null; protectedCapital: boolean; liquidity: string }[]) => {
    const exp = parts.every((p) => p.rate != null) ? parts.reduce((s, p) => s + (p.pct / 100) * (p.rate as number), 0) : null;
    return {
      name, why, parts: parts.map((p) => ({ ...p, amount: r0(amount * p.pct / 100) })), expectedPct: exp != null ? Math.round(exp * 100) / 100 : null,
      protectedPct: parts.filter((p) => p.protectedCapital).reduce((s, p) => s + p.pct, 0),
      in5y: exp != null ? r0(amount * Math.pow(1 + exp / 100, 5)) : null,
      worstYearPct: Math.round(parts.reduce((s, p) => s + (p.pct / 100) * (p.protectedCapital ? (p.rate ?? 0) : -35), 0) * 10) / 10,
    };
  };
  return [
    mk("Conservative", "Protect capital: most money in deposits; a little in funds for growth.", [
      { option: "Savings / call deposit (emergency, instant access)", pct: 20, rate: sav, protectedCapital: true, liquidity: "Instant" },
      { option: "Fixed deposits (1–2 years, best verified rate)", pct: 60, rate: fd, protectedCapital: true, liquidity: "At maturity (early break with penalty)" },
      { option: "Mutual funds (diversified)", pct: 20, rate: eq, protectedCapital: false, liquidity: "Days (sell on NEPSE / redeem)" },
    ]),
    mk("Balanced", "Half safety, half growth: suits 3–7 year goals.", [
      { option: "Savings / call deposit", pct: 10, rate: sav, protectedCapital: true, liquidity: "Instant" },
      { option: "Fixed deposits / debentures", pct: 40, rate: fd, protectedCapital: true, liquidity: "At maturity" },
      { option: "Mutual funds (SIP)", pct: 25, rate: eq, protectedCapital: false, liquidity: "Days" },
      { option: "Strong NEPSE stocks (5+, across sectors)", pct: 25, rate: eq, protectedCapital: false, liquidity: "T+2 for liquid stocks" },
    ]),
    mk("Growth", "For 7+ years and strong nerves: more equity, never all of it.", [
      { option: "Savings / call deposit", pct: 10, rate: sav, protectedCapital: true, liquidity: "Instant" },
      { option: "Fixed deposits / debentures", pct: 20, rate: fd, protectedCapital: true, liquidity: "At maturity" },
      { option: "Mutual funds (SIP)", pct: 30, rate: eq, protectedCapital: false, liquidity: "Days" },
      { option: "Strong NEPSE stocks", pct: 40, rate: eq, protectedCapital: false, liquidity: "T+2 for liquid stocks" },
    ]),
  ];
}

// ---------- v0.11.1: flexible, diversified investment plan ----------
// Works with any starting amount (including zero) and monthly amounts that change from month to
// month. Money first clears costly debt and the emergency fund, then is spread across Nepal's
// investment channels by risk and horizon. Return assumptions come only from the official/market
// rates passed in; where a channel has no rate of its own the assumption is stated.

export interface Channel {
  key: string; name: string; product: string; // seed key of the products catalogue (official links)
  group: "guaranteed" | "market"; ratePct: number | null; rateNote: string;
  liquidity: string; howTo: string; inApp?: { label: string; to: string };
}
export interface PlanInput {
  lumpSum: number; monthly: number[]; // one amount per month; the pattern repeats each year
  stepUpPct?: number; // raise the monthly amounts by this % each year
  risk: Risk; horizonYears: number;
  emergencyGap: number; expensiveDebt: { name: string; balance: number; ratePct: number }[];
  nearTermNeeds: { name: string; amount: number; years: number }[];
  existingEquityPct?: number | null; rates: MarketRates;
}

/** Channels and their share of long-term money for a risk level and horizon (percentages add to 100). */
export function channelMix(risk: Risk, horizonYears: number, rates: MarketRates, existingEquityPct?: number | null) {
  const tax = rates.interestTaxPct / 100;
  const fdNet = rates.fdPct != null ? Math.round(rates.fdPct * (1 - tax) * 100) / 100 : null;
  const eq = rates.equityLongRunPct;
  let cap = equityCap(risk, horizonYears);
  if (existingEquityPct != null && existingEquityPct > cap) cap = Math.max(0, cap - Math.min(cap, existingEquityPct - cap));
  const eqNote = eq != null ? `NEPSE's last-10-year growth incl. dividends (${eq.toFixed(1)}%/yr); not guaranteed, has fallen 30-50% before` : "No long-run NEPSE figure available";
  const C: Record<string, Channel> = {
    fd: { key: "fd", name: "Fixed / recurring deposits", product: "fd", group: "guaranteed", ratePct: fdNet, rateNote: fdNet != null ? `Best verified FD rate after 6% tax (${fdNet}%)` : "Rate unavailable", liquidity: "At maturity (early withdrawal with a penalty)", howTo: "Lump sums: FD at the best verified rate. Monthly: a recurring deposit (RD) in your bank's app.", inApp: { label: "Best deposit rates", to: "/invest?tab=deposits" } },
    debenture: { key: "debenture", name: "Debentures & government bonds", product: "debenture", group: "guaranteed", ratePct: fdNet, rateNote: "Assumed at the FD rate; each issue has its own coupon, so check it", liquidity: "Sell on NEPSE (thin trading) or hold to maturity", howTo: "Apply for new debenture/bond issues in MeroShare; check coupon, maturity and issuer quality.", inApp: { label: "Debentures & bonds", to: "/invest?tab=funds" } },
    cit: { key: "cit", name: "Citizen Investment Trust (CIT)", product: "cit-scheme", group: "guaranteed", ratePct: fdNet, rateNote: "Assumed at the FD rate (CIT publishes its own scheme returns)", liquidity: "Long-term; withdrawal rules per scheme", howTo: "Open a CIT scheme account (branch or online); contributions can be monthly and have tax benefits." },
    sip: { key: "sip", name: "Mutual fund SIP (open-ended)", product: "mf-open", group: "market", ratePct: eq, rateNote: eqNote, liquidity: "Redeem in a few days", howTo: "Start a SIP with a fund manager (via their app, branch or C-ASBA); pick a diversified equity or balanced fund.", inApp: { label: "Mutual funds", to: "/invest?tab=funds" } },
    closed: { key: "closed", name: "Close-ended mutual funds", product: "mf-closed", group: "market", ratePct: eq, rateNote: eqNote, liquidity: "Buy/sell on NEPSE (T+2)", howTo: "Buy listed funds through your broker (TMS), preferably below NAV.", inApp: { label: "Fund NAV vs price", to: "/invest?tab=funds" } },
    stocks: { key: "stocks", name: "Strong NEPSE stocks (5+ across sectors)", product: "nepse-shares", group: "market", ratePct: eq, rateNote: eqNote, liquidity: "Sell on NEPSE (T+2 for liquid stocks)", howTo: "Open a demat (MeroShare) and broker (TMS) account; buy fundamentally strong companies in different sectors.", inApp: { label: "Strong stocks", to: "/opportunities" } },
    gold: { key: "gold", name: "Gold (fine, hallmarked)", product: "gold-silver", group: "market", ratePct: rates.goldPct ?? null, rateNote: rates.goldPct != null ? `FENEGOSIDA official rate history, planned at ${rates.goldPct}%/yr (lower of 10-year and full-history growth); gold has fallen 20%+ before and pays no interest` : "No gold price history available", liquidity: "Sell to a dealer the same day (at the buying rate, below the selling rate)", howTo: "Buy fine (chhapawal) gold coins or bars with a bill from a FENEGOSIDA-member dealer; avoid jewellery for investing (making charges are lost when you sell).", inApp: { label: "Gold & silver prices", to: "/invest?tab=metals" } },
    silver: { key: "silver", name: "Silver", product: "gold-silver", group: "market", ratePct: rates.silverPct ?? null, rateNote: rates.silverPct != null ? `FENEGOSIDA official rate history, planned at ${rates.silverPct}%/yr; swings more than gold` : "No silver price history available", liquidity: "Sell to a dealer (wider buy/sell gap than gold)", howTo: "Buy pure silver bars or coins with a bill; keep it small: silver swings far more than gold.", inApp: { label: "Gold & silver prices", to: "/invest?tab=metals" } },
    ipo: { key: "ipo", name: "IPOs / right shares (small amounts)", product: "ipo", group: "market", ratePct: eq, rateNote: "Allotment is a lottery; returns vary widely", liquidity: "After listing", howTo: "Apply for each IPO in MeroShare (usually 10 units).", inApp: { label: "IPO calendar", to: "/ipo" } },
  };
  const gW: [string, number][] = horizonYears < 2 ? [["fd", 1]] : horizonYears < 5 ? [["fd", 0.7], ["debenture", 0.3]] : [["fd", 0.5], ["debenture", 0.25], ["cit", 0.25]];
  const mW: [string, number][] = risk === "low" ? [["sip", 0.7], ["stocks", 0.3]] : risk === "medium" ? [["sip", 0.45], ["closed", 0.15], ["stocks", 0.35], ["ipo", 0.05]] : [["sip", 0.3], ["closed", 0.15], ["stocks", 0.5], ["ipo", 0.05]];
  // Real assets: a small slice of gold (and silver for high risk) as a hedge against inflation and a weak rupee.
  const metals: [string, number][] = horizonYears < 2 ? [] : risk === "low" ? [["gold", 5]] : risk === "medium" ? [["gold", 10]] : [["gold", 10], ["silver", 3]];
  const usable = metals.filter(([k]) => C[k].ratePct != null);
  const mPct = usable.reduce((a, [, w]) => a + w, 0), scale = (100 - mPct) / 100;
  const mix = [
    ...gW.map(([k, w]) => ({ ...C[k], pct: r1((100 - cap) * w * scale) })),
    ...(cap > 0 ? mW.map(([k, w]) => ({ ...C[k], pct: r1(cap * w * scale) })) : []),
    ...usable.map(([k, w]) => ({ ...C[k], pct: w })),
  ].filter((c) => c.pct > 0);
  return { cap: r1(cap * scale + mPct), equityPart: r1(cap * scale), metalsPct: mPct, mix };
}

/** Builds the plan month by month with three outcomes for the market part. */
export function buildPlan(p: PlanInput) {
  const months = Math.max(12, Math.round(Math.max(1, p.horizonYears) * 12));
  const pattern = p.monthly.length ? p.monthly.map((x) => Math.max(0, x || 0)) : [0];
  const step = (p.stepUpPct ?? 0) / 100;
  const contrib = Array.from({ length: months }, (_, i) => pattern[i % pattern.length] * Math.pow(1 + step, Math.floor(i / 12)));
  const totalIn = p.lumpSum + sum(contrib);
  if (totalIn <= 0) return { ok: false as const, reason: "Enter an amount to invest now, a monthly amount, or both." };

  const { cap, mix, equityPart, metalsPct } = channelMix(p.risk, p.horizonYears, p.rates, p.existingEquityPct);
  const savNet = p.rates.savingPct != null ? p.rates.savingPct * (1 - p.rates.interestTaxPct / 100) : 0;
  // Priorities: costly debt, emergency fund, money needed within 3 years. Lump sum first, then monthly money.
  const prio: { name: string; kind: "debt" | "safety" | "goal"; need: number; ratePct: number; note: string }[] = [
    ...[...p.expensiveDebt].sort((a, b) => b.ratePct - a.ratePct).map((d) => ({ name: `Repay ${d.name}`, kind: "debt" as const, need: d.balance, ratePct: d.ratePct, note: `Saves ${d.ratePct}% a year, guaranteed` })),
    { name: "Emergency fund", kind: "safety" as const, need: p.emergencyGap, ratePct: savNet, note: "Instant-access savings so you never sell investments in a hurry" },
    ...p.nearTermNeeds.filter((g) => g.years <= 3).map((g) => ({ name: `${g.name} (in ${g.years} yr)`, kind: "goal" as const, need: g.amount, ratePct: p.rates.fdPct != null ? p.rates.fdPct * (1 - p.rates.interestTaxPct / 100) : 0, note: "Kept in deposits matched to the date, not shares" })),
  ].filter((x) => x.need > 0);
  const prioFilled = prio.map(() => 0);
  const prioMonthDone: (number | null)[] = prio.map(() => null);
  const lumpTo = mix.map(() => 0), monthlyTo = mix.map(() => 0);
  const bal = { low: mix.map(() => 0), mid: mix.map(() => 0), high: mix.map(() => 0) };
  let prioBal = 0;
  const rateFor = (c: Channel, s: "low" | "mid" | "high") => c.ratePct == null ? 0 : c.group === "guaranteed" ? c.ratePct : s === "mid" ? c.ratePct : s === "low" ? Math.max(-5, c.ratePct - 8) : c.ratePct + 6;
  const prioRate = prio.length ? prio.reduce((s, x) => s + x.ratePct * x.need, 0) / sum(prio.map((x) => x.need)) : 0;
  const place = (amount: number, month: number, into: number[]) => {
    let left = amount;
    for (let i = 0; i < prio.length && left > 0; i++) {
      const take = Math.min(left, prio[i].need - prioFilled[i]);
      if (take > 0) { prioFilled[i] += take; left -= take; prioBal += take; if (prioFilled[i] >= prio[i].need - 0.5 && prioMonthDone[i] == null) prioMonthDone[i] = month; }
    }
    if (left > 0) mix.forEach((c, j) => { const a = left * c.pct / 100; into[j] += a; bal.low[j] += a; bal.mid[j] += a; bal.high[j] += a; });
  };
  place(p.lumpSum, 0, lumpTo);
  const yearly: { year: number; paidIn: number; low: number; mid: number; high: number }[] = [];
  let paid = p.lumpSum;
  for (let m = 0; m < months; m++) {
    for (const s of ["low", "mid", "high"] as const) mix.forEach((c, j) => { bal[s][j] *= 1 + rateFor(c, s) / 1200; });
    prioBal *= 1 + prioRate / 1200;
    place(contrib[m], m + 1, monthlyTo);
    paid += contrib[m];
    if ((m + 1) % 12 === 0 || m === months - 1) yearly.push({ year: r1((m + 1) / 12), paidIn: r0(paid), low: r0(prioBal + sum(bal.low)), mid: r0(prioBal + sum(bal.mid)), high: r0(prioBal + sum(bal.high)) });
  }
  const avgMonthly = sum(contrib) / months;
  const guaranteedIn = sum(prioFilled) + sum(mix.map((c, j) => c.group === "guaranteed" ? lumpTo[j] + monthlyTo[j] : 0));
  return {
    ok: true as const, equityCapPct: cap, equityPart, metalsPct, months, totalIn: r0(totalIn), avgMonthly: r0(avgMonthly),
    guaranteedPct: r1(guaranteedIn / totalIn * 100),
    priorities: prio.map((x, i) => ({ name: x.name, kind: x.kind, amount: r0(prioFilled[i]), need: r0(x.need), done: prioFilled[i] >= x.need - 0.5, monthDone: prioMonthDone[i], note: x.note })),
    channels: mix.map((c, j) => ({ ...c, lump: r0(lumpTo[j]), monthlyTotal: r0(monthlyTo[j]), monthlyAvg: r0(monthlyTo[j] / months), final: { low: r0(bal.low[j]), mid: r0(bal.mid[j]), high: r0(bal.high[j]) } })),
    yearly,
    notes: [
      "Guaranteed parts grow at their contractual after-tax rate; market-linked parts show a weak, expected and strong case (expected minus 8 points, expected, expected plus 6 points a year). These are scenarios, not forecasts.",
      ...(p.stepUpPct ? [`Monthly amounts rise ${p.stepUpPct}% each year.`] : []),
      ...(pattern.length > 1 ? [`Your ${pattern.length}-month pattern repeats every year (average Rs. ${fmt(sum(pattern) / pattern.length)} a month).`] : []),
    ],
  };
}

/** Maps FENEGOSIDA's Nepali rate names to our items: fine (chhapawal) gold and silver, per tola and per 10 grams. */
export function metalItem(rateType: string): string | null {
  const gold = /सुन/.test(rateType), silver = /चाँदी/.test(rateType);
  const unit = /तोला/.test(rateType) ? "tola" : /१० ग्राम|10 ?g/i.test(rateType) ? "10g" : null;
  if (!unit || gold === silver) return null;
  return `${gold ? "gold" : "silver"}_${unit}`;
}
