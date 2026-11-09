// Plain-language pros and cons from computed ratios, grouped by category. Thresholds follow common
// Nepal practice and NRB limits where they exist (e.g. CD ratio cap 90%, CAR minimum 11%, NPL).
// Each line names the number it is based on. Pure; tested.

export interface ProCon { side: "pro" | "con"; category: string; text: string }
type Metrics = Record<string, number | null | undefined>;

const p1 = (x: number) => (Math.round(x * 10) / 10).toString();

export function prosCons(sector: string, m: Metrics, ctx: { profitYoY?: number | null; dividendYears5?: number | null; sectorPe?: number | null; price?: number | null }): ProCon[] {
  const out: ProCon[] = [];
  const pro = (category: string, text: string) => out.push({ side: "pro", category, text });
  const con = (category: string, text: string) => out.push({ side: "con", category, text });
  const bank = /bank|finance|microfinance/i.test(sector);
  const insurer = /insurance/i.test(sector);
  const hydro = /hydro/i.test(sector);
  if (ctx.profitYoY != null) { if (ctx.profitYoY >= 10) pro("Growth", `Profit grew ${p1(ctx.profitYoY)}% on the same period last year.`); else if (ctx.profitYoY <= -10) con("Growth", `Profit fell ${p1(-ctx.profitYoY)}% on the same period last year.`); }
  if (m.roe != null) { if (m.roe >= 15) pro("Profitability", `Return on shareholders' money is ${p1(m.roe)}%, a strong level.`); else if (m.roe < 10) con("Profitability", `Return on shareholders' money is only ${p1(m.roe)}%.`); }
  if (m.netMargin != null && !bank) { if (m.netMargin >= 20) pro("Margins", `Keeps ${p1(m.netMargin)}% of revenue as profit.`); else if (m.netMargin < 5) con("Margins", `Keeps only ${p1(m.netMargin)}% of revenue as profit.`); }
  if (m.pe != null && m.pe > 0 && ctx.sectorPe) { if (m.pe < ctx.sectorPe * 0.8) pro("Valuation", `P/E ${p1(m.pe)} is below the sector's typical ${p1(ctx.sectorPe)}.`); else if (m.pe > ctx.sectorPe * 1.4) con("Valuation", `P/E ${p1(m.pe)} is well above the sector's typical ${p1(ctx.sectorPe)}.`); }
  if (m.pe != null && m.pe <= 0) con("Valuation", "No positive earnings, so P/E is not meaningful.");
  if (m.pb != null) { if (m.pb < 1.2) pro("Valuation", `Trades near its book value (P/B ${p1(m.pb)}).`); else if (m.pb > 4) con("Valuation", `Priced at ${p1(m.pb)}× its book value.`); }
  if (m.bvps != null && m.bvps > 0) pro("Shareholder value", `Each share is backed by Rs. ${p1(m.bvps)} of the company's own net worth.`);
  if (ctx.dividendYears5 != null) { if (ctx.dividendYears5 >= 4) pro("Shareholder returns", `Paid dividends in ${ctx.dividendYears5} of the last 5 years.`); else if (ctx.dividendYears5 <= 1) con("Shareholder returns", `Paid dividends in only ${ctx.dividendYears5} of the last 5 years.`); }
  if (bank) {
    if (m.npl != null) { if (m.npl <= 2) pro("Asset quality", `Bad loans are ${p1(m.npl)}% of lending, a healthy level.`); else if (m.npl >= 5) con("Asset quality", `Bad loans are ${p1(m.npl)}% of lending, which eats into profit.`); }
    if (m.car != null) { if (m.car >= 13) pro("Capital strength", `Capital adequacy ${p1(m.car)}% is comfortably above NRB's 11% minimum.`); else if (m.car < 11.5) con("Capital strength", `Capital adequacy ${p1(m.car)}% is close to NRB's 11% minimum.`); }
    if (m.cd != null) { if (m.cd <= 85) pro("Liquidity", `Lends ${p1(m.cd)}% of deposits, within NRB's 90% limit.`); else if (m.cd > 89) con("Liquidity", `Lends ${p1(m.cd)}% of deposits, at NRB's 90% limit.`); }
    if (m.costIncome != null) { if (m.costIncome <= 40) pro("Efficiency", `Costs are ${p1(m.costIncome)}% of income: well controlled.`); else if (m.costIncome >= 55) con("Efficiency", `Costs take ${p1(m.costIncome)}% of income.`); }
    if (m.creditCost != null && m.creditCost >= 10) con("Asset quality", `${p1(m.creditCost)}% of operating income goes to loan-loss provisions.`);
    if (m.spread != null && m.spread < 4) con("Margins", `Interest spread is ${p1(m.spread)}%, so core lending earns little.`);
  }
  if (insurer) {
    if (m.solvency != null) { if (m.solvency >= 2) pro("Capital strength", `Solvency ratio ${p1(m.solvency)}, above the usual 1.5 benchmark.`); else if (m.solvency < 1.5) con("Capital strength", `Solvency ratio ${p1(m.solvency)} is below the usual 1.5 benchmark.`); }
    if (m.claimsRatio != null && m.claimsRatio > 75) con("Underwriting", `Claims take ${p1(m.claimsRatio)}% of net premium.`);
  }
  if (hydro || (!bank && !insurer)) {
    if (m.de != null) { if (m.de <= 1) pro("Debt", `Debt is ${p1(m.de)}× equity: manageable.`); else if (m.de >= 2) con("Debt", `Debt is ${p1(m.de)}× equity: heavily borrowed.`); }
    if (m.interestCover != null) { if (m.interestCover >= 3) pro("Debt", `Earnings cover interest ${p1(m.interestCover)} times.`); else if (m.interestCover < 1.5) con("Debt", `Earnings cover interest only ${p1(m.interestCover)} times.`); }
    if (m.currentRatio != null && m.currentRatio < 1) con("Liquidity", `Current ratio ${p1(m.currentRatio)}: short-term debts exceed short-term assets.`);
  }
  return out;
}
