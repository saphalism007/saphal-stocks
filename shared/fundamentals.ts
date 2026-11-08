// Fundamental analysis from source financial statements (quarterly reports as
// published by the company). We compute ratios ourselves from line items and
// show the company's own reported ratios next to them as a cross-check.
// Nepali quarterly statements are cumulative year-to-date, so profit is
// annualised as YTD x 4 / quarter.
import { sectorGroup, type SectorGroup } from "./types.ts";

export type StatementKind = "balance_sheet" | "income" | "metrics";
export interface StatementItem { statement: StatementKind; label: string; value: number | null }
export interface QuarterReport {
  symbol: string;
  period: string; // e.g. "1st Quarter 2083/2084"
  fiscalYear: string; // "2083/2084"
  quarter: number; // 1-4
  items: StatementItem[];
  source: string;
  fetchedAt: string;
}
export interface DividendRecord { fiscalYear: string; cashPct: number | null; bonusPct: number | null; bookCloseDate: string | null; announcementDate: string | null }

export interface FundamentalInput {
  symbol: string;
  sector: string;
  price: number | null;
  priceDate: string | null;
  listedShares: number | null;
  faceValue: number | null; // Rs. per share (usually 100)
  reports: QuarterReport[]; // any order
  dividends: DividendRecord[];
}

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: "%" | "Rs." | "x" | "Rs. '000" | "";
  basis: "computed" | "reported" | "market";
  formula?: string;
  reported?: number | null; // company's own figure, when available
  note?: string;
}

export interface FundamentalScore {
  overall: number | null;
  components: { name: string; score: number | null; weight: number; drivers: string[] }[];
  sectorGroup: SectorGroup;
  model: string;
}

export interface FundamentalAnalysis {
  symbol: string;
  sector: string;
  sectorGroup: SectorGroup;
  latestPeriod: string | null;
  periods: string[];
  metrics: Metric[];
  byKey: Record<string, number | null>;
  growth: { label: string; value: number | null; basis: string }[];
  dividend: { latestYear: string | null; cashPct: number | null; bonusPct: number | null; cashYieldPct: number | null; yearsPaidLast5: number; history: DividendRecord[] };
  score: FundamentalScore;
  redFlags: string[];
  strengths: string[];
  dataNotes: string[];
}

const ord: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, first: 1, second: 2, third: 3, fourth: 4 };
export function parsePeriod(period: string): { fiscalYear: string; quarter: number } | null {
  const m = period.match(/(1st|2nd|3rd|4th|first|second|third|fourth)\s+quarter\s+(\d{4}\/\d{2,4})/i);
  if (!m) return null;
  let fy = m[2];
  if (/^\d{4}\/\d{2}$/.test(fy)) fy = fy.slice(0, 4) + "/" + fy.slice(0, 2) + fy.slice(5);
  return { fiscalYear: fy, quarter: ord[m[1].toLowerCase()] };
}
export const periodKey = (r: { fiscalYear: string; quarter: number }) => `${r.fiscalYear}-Q${r.quarter}`;

function find(items: StatementItem[], kind: StatementKind | StatementKind[], patterns: RegExp[], exclude?: RegExp): number | null {
  const kinds = Array.isArray(kind) ? kind : [kind];
  for (const p of patterns) {
    const it = items.find((i) => kinds.includes(i.statement) && p.test(i.label) && !(exclude && exclude.test(i.label)) && i.value != null);
    if (it) return it.value;
  }
  return null;
}

const div = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);
const r2 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** Linear score: `bad` -> 0, `good` -> 100 (works for both directions). */
export function scale(x: number | null, bad: number, good: number): number | null {
  if (x == null || !Number.isFinite(x)) return null;
  const t = (x - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

interface Core {
  netProfitYtd: number | null; netProfitAnnual: number | null; equity: number | null; totalAssets: number | null;
  revenueYtd: number | null; shares: number | null; eps: number | null; bvps: number | null;
}

export function extractCore(r: QuarterReport, listedShares: number | null, group: SectorGroup, faceValue: number | null = 100): Core {
  const it = r.items;
  const np = find(it, "income", [/^profit for the (period|year)/i, /^net profit\s*\/?\s*\(?loss\)? for the (year|period)/i, /^net profit\b(?!.*before)/i, /profit.*after tax/i, /^net (profit|income)/i], /before|margin|share of|to /i);
  let equity = find(it, "balance_sheet", [/^total (shareholders'? )?equity$/i, /^total equity/i, /shareholders'? fund/i], /liabilities/i);
  if (equity == null && group === "hydro") {
    const pu = find(it, "balance_sheet", [/^paid ?up capital/i, /^share capital/i]);
    const rs = find(it, "balance_sheet", [/^reserve/i]);
    if (pu != null) equity = pu + (rs ?? 0);
  }
  if (equity == null) equity = find(it, "metrics", [/total shareholder'?s equity/i]);
  let totalAssets = find(it, "balance_sheet", [/^total assets/i, /^application of fund/i, /^sources of fund/i]);
  const revenue = find(it, "income", [/^total operating income/i, /^operating income/i, /^total income/i, /^gross earned premium/i, /^revenue/i, /^sales/i, /^total revenue/i]);
  const outstanding = find(it, "metrics", [/no\.? of outstanding shares/i]);
  const shareCap = find(it, "balance_sheet", [/^share capital$/i, /^paid ?up capital/i]);
  // Prefer the period-end share count implied by share capital (includes bonus shares issued
  // but not yet listed); fall back to the reported count, then listed shares.
  const shares = (shareCap != null && shareCap > 0 ? (shareCap * 1000) / (faceValue || 100) : null) ?? outstanding ?? listedShares;
  const annual = np != null ? (np * 4) / r.quarter : null;
  if (totalAssets != null && totalAssets <= 0) totalAssets = null;
  return {
    netProfitYtd: np, netProfitAnnual: annual, equity, totalAssets, revenueYtd: revenue, shares,
    eps: annual != null && shares ? (annual * 1000) / shares : null,
    bvps: equity != null && shares ? (equity * 1000) / shares : null,
  };
}

export function analyzeFundamentals(input: FundamentalInput): FundamentalAnalysis {
  const group = sectorGroup(input.sector);
  const reports = [...input.reports].sort((a, b) => (periodKey(a) < periodKey(b) ? 1 : -1));
  const latest = reports[0];
  const metrics: Metric[] = [];
  const redFlags: string[] = [];
  const strengths: string[] = [];
  const dataNotes: string[] = [];
  const add = (m: Metric) => metrics.push({ ...m, value: r2(m.value), reported: m.reported != null ? r2(m.reported) : m.reported });
  const price = input.price;

  let core: Core | null = null;
  if (latest) {
    core = extractCore(latest, input.listedShares, group, input.faceValue);
    const it = latest.items;
    const repEps = find(it, "metrics", [/earnings? per share/i, /\beps\b/i], /diluted/i);
    const repBv = find(it, "metrics", [/net ?worth per share/i, /book value per share/i]);
    const repRoe = find(it, "metrics", [/return on equity/i]);
    const repRoa = find(it, "metrics", [/return on assets?/i]);
    add({ key: "netProfitYtd", label: `Net profit (${latest.period}, year-to-date)`, value: core.netProfitYtd, unit: "Rs. '000", basis: "reported" });
    add({ key: "netProfitAnnual", label: "Net profit, annualised", value: core.netProfitAnnual, unit: "Rs. '000", basis: "computed", formula: `YTD profit x 4 / ${latest.quarter}` });
    add({ key: "equity", label: "Net worth (total equity)", value: core.equity, unit: "Rs. '000", basis: "reported" });
    add({ key: "totalAssets", label: "Total assets", value: core.totalAssets, unit: "Rs. '000", basis: "reported" });
    add({ key: "eps", label: "EPS (annualised)", value: core.eps, unit: "Rs.", basis: "computed", formula: "Annualised net profit / shares (share capital / face value at period end)", reported: repEps });
    add({ key: "bvps", label: "Book value per share", value: core.bvps, unit: "Rs.", basis: "computed", formula: "Total equity / shares (share capital / face value)", reported: repBv });
    const roe = div(core.netProfitAnnual, core.equity);
    const roa = div(core.netProfitAnnual, core.totalAssets);
    add({ key: "roe", label: "Return on equity", value: roe != null ? roe * 100 : null, unit: "%", basis: "computed", formula: "Annualised net profit / closing equity", reported: repRoe });
    add({ key: "roa", label: "Return on assets", value: roa != null ? roa * 100 : null, unit: "%", basis: "computed", formula: "Annualised net profit / total assets", reported: repRoa });
    if (price != null) {
      add({ key: "pe", label: "Price / earnings", value: core.eps && core.eps > 0 ? price / core.eps : null, unit: "x", basis: "market", formula: `Price Rs. ${price} / EPS`, note: core.eps != null && core.eps <= 0 ? "Not meaningful: earnings are zero or negative." : undefined });
      add({ key: "pb", label: "Price / book", value: core.bvps && core.bvps > 0 ? price / core.bvps : null, unit: "x", basis: "market", formula: `Price Rs. ${price} / book value per share` });
      if (core.eps && core.bvps && core.eps > 0 && core.bvps > 0) {
        add({ key: "graham", label: "Graham number", value: Math.sqrt(22.5 * core.eps * core.bvps), unit: "Rs.", basis: "computed", formula: "sqrt(22.5 x EPS x BVPS): a conservative fair-value ceiling (P/E 15 x P/B 1.5)" });
      }
      if (core.shares) add({ key: "marketCap", label: "Market capitalisation", value: (price * core.shares) / 1000, unit: "Rs. '000", basis: "market", formula: "Price x shares at period end" });
    }
    if (repEps != null && core.eps != null && Math.abs(core.eps - repEps) / Math.max(Math.abs(repEps), 1) > 0.15) {
      dataNotes.push(`Computed EPS (Rs. ${r2(core.eps)}) differs from the reported EPS (Rs. ${r2(repEps)}) by more than 15%. Share count or profit basis may differ (e.g. bonus shares listed after the period, or profit attributable to parent).`);
    }

    // Sector-specific ratios.
    if (group === "bank" || group === "microfinance") {
      const nii = find(it, "income", [/^net interest income/i]);
      const toi = find(it, "income", [/^total operating income/i]);
      const opex = ["personnel expense", "other operating expense", "depreciation"].map((k) => find(it, "income", [new RegExp("^" + k, "i")])).reduce<number | null>((s, v) => (v == null ? s : (s ?? 0) + v), null);
      const loans = find(it, "balance_sheet", [/^loans? and advances to customers/i, /^loans? (and|&) advances/i]);
      const deposits = find(it, "balance_sheet", [/^deposits? from customers/i, /^deposits?/i]);
      const impairment = find(it, "income", [/^impairment charge/i]);
      add({ key: "npl", label: "Non-performing loans / total loans", value: find(it, "metrics", [/non.?performing loan/i, /\bnpl\b/i], /provision/i), unit: "%", basis: "reported" });
      add({ key: "car", label: "Capital adequacy (capital fund / RWA)", value: find(it, "metrics", [/capital fund to rwa/i, /capital adequacy/i]), unit: "%", basis: "reported", note: "NRB minimum for commercial banks is 11% including buffer (verify current directive)." });
      add({ key: "tier1", label: "Tier 1 capital / RWA", value: find(it, "metrics", [/tier i capital/i]), unit: "%", basis: "reported" });
      add({ key: "cd", label: "Credit to deposit ratio", value: find(it, "metrics", [/credit to deposit/i, /\bcd ratio/i]), unit: "%", basis: "reported" });
      add({ key: "provisionCoverage", label: "Loan loss provision / NPL", value: find(it, "metrics", [/loan loss provision to total npl/i]), unit: "%", basis: "reported" });
      add({ key: "costOfFunds", label: "Cost of funds", value: find(it, "metrics", [/cost of funds?/i]), unit: "%", basis: "reported" });
      add({ key: "spread", label: "Interest spread", value: find(it, "metrics", [/interest spread/i]), unit: "%", basis: "reported" });
      add({ key: "baseRate", label: "Base rate", value: find(it, "metrics", [/base rate/i]), unit: "%", basis: "reported" });
      add({ key: "nim", label: "Net interest margin (on assets)", value: nii != null && core.totalAssets ? ((nii * 4) / latest.quarter / core.totalAssets) * 100 : null, unit: "%", basis: "computed", formula: "Annualised net interest income / total assets" });
      add({ key: "costIncome", label: "Cost to income", value: opex != null && toi ? (opex / toi) * 100 : null, unit: "%", basis: "computed", formula: "(Personnel + other operating expense + depreciation) / total operating income" });
      add({ key: "loanDeposit", label: "Loans / deposits (balance sheet)", value: loans != null && deposits ? (loans / deposits) * 100 : null, unit: "%", basis: "computed" });
      add({ key: "creditCost", label: "Impairment charge / operating income", value: impairment != null && toi ? (impairment / toi) * 100 : null, unit: "%", basis: "computed" });
    } else if (group === "hydro") {
      const debt = find(it, "balance_sheet", [/^loans? (&|and) long.?term liabilities/i, /^long.?term loans?/i, /^borrowings?/i]);
      const finExp = find(it, "income", [/^financial expenses?/i, /^finance costs?/i, /^interest expenses?/i]);
      const sales = find(it, "income", [/sales of electricity/i, /^operating income/i, /^revenue/i]);
      const reserve = find(it, "balance_sheet", [/^reserve/i]);
      add({ key: "de", label: "Debt / equity", value: div(debt, core.equity), unit: "x", basis: "computed", formula: "Loans & long-term liabilities / equity" });
      add({ key: "interestCover", label: "Interest coverage", value: core.netProfitYtd != null && finExp ? (core.netProfitYtd + finExp) / finExp : null, unit: "x", basis: "computed", formula: "(Net profit + financial expenses) / financial expenses (approx. EBIT/interest, pre-tax effects ignored)" });
      add({ key: "netMargin", label: "Net profit margin", value: core.netProfitYtd != null && sales ? (core.netProfitYtd / sales) * 100 : null, unit: "%", basis: "computed" });
      add({ key: "currentRatio", label: "Current ratio", value: find(it, "metrics", [/current ratio/i]) ?? div(find(it, "balance_sheet", [/^total current assets/i]), find(it, "balance_sheet", [/^total current liabilities/i])), unit: "x", basis: "computed" });
      add({ key: "reserves", label: "Reserves & surplus", value: reserve, unit: "Rs. '000", basis: "reported" });
      if (reserve != null && reserve < 0) redFlags.push("Accumulated losses: reserves & surplus are negative, which usually rules out cash dividends until losses are recovered.");
    } else if (group === "insurance") {
      const gp = find(it, "income", [/^gross (earned |written )?premiums?/i]);
      add({ key: "solvency", label: "Solvency ratio", value: find(it, "metrics", [/solvency/i]), unit: "x", basis: "reported", note: "Nepal Insurance Authority requires at least 1.5x (verify current directive)." });
      add({ key: "netProfitToPremium", label: "Net profit / gross premium", value: core.netProfitYtd != null && gp ? (core.netProfitYtd / gp) * 100 : null, unit: "%", basis: "computed", reported: find(it, "metrics", [/net profit to gross premium/i]) });
      add({ key: "grossPremium", label: "Gross premium (YTD)", value: gp, unit: "Rs. '000", basis: "reported" });
      add({ key: "claimsRatio", label: "Net claims / net premium", value: div(find(it, "income", [/^net (benefits and )?claims/i]), find(it, "income", [/^net earned premiums?/i])) != null ? (div(find(it, "income", [/^net (benefits and )?claims/i]), find(it, "income", [/^net earned premiums?/i])) as number) * 100 : null, unit: "%", basis: "computed" });
    } else {
      const debt = find(it, "balance_sheet", [/borrowings?/i, /^loans?/i, /long.?term (loans?|liabilities)/i]);
      add({ key: "de", label: "Debt / equity", value: div(debt, core.equity), unit: "x", basis: "computed" });
      add({ key: "netMargin", label: "Net profit margin", value: core.netProfitYtd != null && core.revenueYtd ? (core.netProfitYtd / core.revenueYtd) * 100 : null, unit: "%", basis: "computed" });
      add({ key: "currentRatio", label: "Current ratio", value: find(it, "metrics", [/current ratio/i]) ?? div(find(it, "balance_sheet", [/total current assets/i]), find(it, "balance_sheet", [/total current liabilities/i])), unit: "x", basis: "computed" });
    }
  } else {
    dataNotes.push("No quarterly financial statements stored yet for this company. Fetch them from the company page (Financials tab).");
  }

  const byKey: Record<string, number | null> = {};
  for (const m of metrics) byKey[m.key] = m.value;

  // Growth: same quarter last year (true YoY) and previous quarter (YTD profits are converted to standalone quarters when possible).
  const growth: FundamentalAnalysis["growth"] = [];
  if (latest && core) {
    const lastYearSameQ = reports.find((r) => r.quarter === latest.quarter && r.fiscalYear !== latest.fiscalYear && fyIndex(r.fiscalYear) === fyIndex(latest.fiscalYear) - 1);
    if (lastYearSameQ) {
      const prev = extractCore(lastYearSameQ, null, group);
      growth.push({ label: `Net profit YoY (${latest.period} vs ${lastYearSameQ.period})`, value: pctChange(core.netProfitYtd, prev.netProfitYtd), basis: "Year-to-date profit vs same period last year" });
      growth.push({ label: "Revenue / operating income YoY", value: pctChange(core.revenueYtd, prev.revenueYtd), basis: "Year-to-date" });
      if (prev.equity != null) growth.push({ label: "Net worth YoY", value: pctChange(core.equity, prev.equity), basis: "Balance sheet" });
    } else {
      dataNotes.push("Year-over-year growth needs last year's same-quarter report; it becomes available as reports accumulate.");
    }
    const prevQ = reports.find((r) => fyIndex(r.fiscalYear) * 4 + r.quarter === fyIndex(latest.fiscalYear) * 4 + latest.quarter - 1);
    if (prevQ) {
      const pc = extractCore(prevQ, null, group);
      const standalone = latest.quarter === 1 ? core.netProfitYtd : core.netProfitYtd != null && pc.netProfitYtd != null ? core.netProfitYtd - pc.netProfitYtd : null;
      const prevStandalone = prevQ.quarter === 1 ? pc.netProfitYtd : null;
      growth.push({ label: `Standalone quarter profit (${latest.period})`, value: standalone, basis: "Rs. '000, YTD difference" });
      if (prevStandalone != null && latest.quarter === 2) growth.push({ label: "Q2 vs Q1 standalone profit", value: pctChange(standalone, prevStandalone), basis: "%" });
    }
  }

  // Dividends.
  const divs = [...input.dividends].sort((a, b) => (a.fiscalYear < b.fiscalYear ? 1 : -1));
  const ld = divs[0] || null;
  const face = input.faceValue ?? 100;
  const cashYield = ld && ld.cashPct != null && price ? ((ld.cashPct / 100) * face / price) * 100 : null;
  const recent5 = divs.slice(0, 5);
  const yearsPaid = recent5.filter((d) => (d.cashPct ?? 0) + (d.bonusPct ?? 0) > 0).length;
  byKey.cashYield = r2(cashYield);
  byKey.yearsPaid5 = yearsPaid;
  // Dividend sustainability: last declared dividend per share vs current annualised EPS.
  const eps0 = core?.eps ?? null;
  const dps = ld?.cashPct != null ? (ld.cashPct / 100) * face : null;
  const totalPs = ld ? (((ld.cashPct ?? 0) + (ld.bonusPct ?? 0)) / 100) * face : null;
  if (dps != null && eps0 != null && eps0 > 0) {
    const payout = (dps / eps0) * 100;
    metrics.push({ key: "payoutCash", label: "Cash payout ratio (last dividend / EPS)", value: r2(payout), unit: "%", basis: "computed", formula: `Rs. ${r2(dps)} cash per share / annualised EPS` });
    if (totalPs != null) metrics.push({ key: "payoutTotal", label: "Total payout incl. bonus", value: r2((totalPs / eps0) * 100), unit: "%", basis: "computed", formula: "(cash + bonus %) x face value / EPS" });
    byKey.payoutCash = r2(payout);
    if (payout > 100) redFlags.push(`Last cash dividend (Rs. ${r2(dps)}/share) is more than current annualised EPS: at this profit level it may not be sustainable.`);
    else if (payout >= 20 && payout <= 70 && yearsPaid >= 4) strengths.push(`Sustainable-looking dividend: ${r2(payout)}% cash payout with ${yearsPaid}/5 years paid.`);
  }
  const bonusHeavy = recent5.filter((d) => (d.bonusPct ?? 0) > (d.cashPct ?? 0)).length;
  if (bonusHeavy >= 3) dataNotes.push(`Dividends were mostly bonus shares in ${bonusHeavy} of the last 5 years: bonus shares grow share count (dilution) and EPS falls unless profit grows as fast.`);

  // Scoring by sector model.
  const v = byKey;
  const comps: FundamentalScore["components"] = [];
  const comp = (name: string, weight: number, parts: [string, number | null][]) => {
    const valid = parts.filter((p) => p[1] != null) as [string, number][];
    comps.push({ name, weight, score: valid.length ? Math.round(valid.reduce((s, p) => s + p[1], 0) / valid.length) : null, drivers: valid.map(([l, s]) => `${l}: ${s}/100`) });
  };
  let model = "";
  if (group === "bank" || group === "microfinance") {
    model = group === "bank" ? "Banking model (BFIs): profitability via ROE/ROA, asset quality via NPL and provision cover, capital via CAR, valuation via P/B and P/E." : "Microfinance model: ROE, NPL (higher tolerance), capital, P/B and P/E.";
    comp("Profitability", 0.3, [["ROE", scale(v.roe, 6, 16)], ["ROA", scale(v.roa, 0.5, 1.8)], ["Cost/income", scale(v.costIncome, 60, 35)]]);
    comp("Asset quality & capital", 0.3, [["NPL", scale(v.npl, group === "bank" ? 6 : 8, group === "bank" ? 1.5 : 2.5)], ["CAR", scale(v.car, 11, 14)], ["Provision cover", scale(v.provisionCoverage, 70, 130)]]);
    comp("Valuation", 0.25, [["P/B", scale(v.pb, 3.5, 1.0)], ["P/E", scale(v.pe, 35, 10)]]);
    comp("Dividend", 0.15, [["Years paid (5)", scale(yearsPaid, 0, 5)], ["Cash yield", scale(cashYield, 0, 6)]]);
  } else if (group === "insurance") {
    model = "Insurance model: ROE, solvency, profit/premium, valuation (P/E, P/B) and dividends.";
    comp("Profitability", 0.3, [["ROE", scale(v.roe, 4, 15)], ["Profit/premium", scale(v.netProfitToPremium, 0, 12)]]);
    comp("Financial strength", 0.25, [["Solvency", scale(v.solvency, 1.3, 3)]]);
    comp("Valuation", 0.3, [["P/E", scale(v.pe, 60, 15)], ["P/B", scale(v.pb, 5, 1.5)]]);
    comp("Dividend", 0.15, [["Years paid (5)", scale(yearsPaid, 0, 5)], ["Cash yield", scale(cashYield, 0, 4)]]);
  } else if (group === "hydro") {
    model = "Hydropower model: positive earnings and ROE, leverage (debt/equity) and interest cover, liquidity, valuation (P/B weighs more than P/E for project companies).";
    comp("Profitability", 0.3, [["ROE", scale(v.roe, 2, 16)], ["Net margin", scale(v.netMargin, 5, 45)], ["EPS positive", v.eps == null ? null : v.eps > 0 ? 100 : 0]]);
    comp("Financial health", 0.35, [["Debt/equity", scale(v.de, 3, 0.8)], ["Interest cover", scale(v.interestCover, 1, 3)], ["Current ratio", scale(v.currentRatio, 0.8, 1.8)]]);
    comp("Valuation", 0.25, [["P/B", scale(v.pb, 5, 1.2)], ["P/E", scale(v.pe, 80, 20)]]);
    comp("Dividend", 0.1, [["Years paid (5)", scale(yearsPaid, 0, 5)]]);
  } else {
    model = "General model (manufacturing, hotels, trading, investment, others): ROE, margins, leverage, liquidity, valuation, dividends.";
    comp("Profitability", 0.3, [["ROE", scale(v.roe, 3, 18)], ["Net margin", scale(v.netMargin, 0, 20)]]);
    comp("Financial health", 0.25, [["Debt/equity", scale(v.de, 2.5, 0.5)], ["Current ratio", scale(v.currentRatio, 0.8, 2)]]);
    comp("Valuation", 0.3, [["P/E", scale(v.pe, 50, 12)], ["P/B", scale(v.pb, 5, 1.2)]]);
    comp("Dividend", 0.15, [["Years paid (5)", scale(yearsPaid, 0, 5)], ["Cash yield", scale(cashYield, 0, 5)]]);
  }
  const growthVal = growth.find((g) => g.label.startsWith("Net profit YoY"))?.value ?? null;
  if (growthVal != null) comp("Growth", 0.15, [["Profit YoY", scale(growthVal, -20, 25)]]);
  const valid = comps.filter((c) => c.score != null);
  const wsum = valid.reduce((s, c) => s + c.weight, 0);
  const overall = valid.length >= 2 && wsum ? Math.round(valid.reduce((s, c) => s + (c.score as number) * c.weight, 0) / wsum) : null;

  // Flags.
  if (v.eps != null && v.eps < 0) redFlags.push("Loss-making: annualised EPS is negative.");
  if (v.npl != null && v.npl > 5) redFlags.push(`High NPL (${v.npl}%): asset quality is weak.`);
  if (v.car != null && v.car < 11.5) redFlags.push(`Capital adequacy (${v.car}%) is close to or below the regulatory minimum.`);
  if (v.solvency != null && v.solvency < 1.5) redFlags.push(`Solvency ratio ${v.solvency}x is below 1.5x.`);
  if (v.de != null && v.de > 3) redFlags.push(`High leverage: debt/equity ${v.de}x.`);
  if (v.interestCover != null && v.interestCover < 1.2) redFlags.push(`Interest cover ${v.interestCover}x: earnings barely cover finance costs.`);
  if (v.pe != null && v.pe > 60) redFlags.push(`Very high valuation: P/E ${v.pe}x.`);
  if (growthVal != null && growthVal < -25) redFlags.push(`Net profit fell ${Math.abs(growthVal)}% year-over-year.`);
  if (v.roe != null && v.roe >= 15) strengths.push(`Strong ROE of ${v.roe}%.`);
  if (v.npl != null && v.npl < 2) strengths.push(`Clean asset quality (NPL ${v.npl}%).`);
  if (v.pb != null && v.pb < 1.2 && v.pb > 0) strengths.push(`Trading near book value (P/B ${v.pb}x).`);
  if (yearsPaid >= 4) strengths.push(`Paid dividends in ${yearsPaid} of the last 5 years.`);
  if (growthVal != null && growthVal > 20) strengths.push(`Net profit up ${growthVal}% year-over-year.`);
  if (v.graham != null && price != null && price < v.graham) strengths.push(`Price is below the Graham number (Rs. ${v.graham}).`);

  return {
    symbol: input.symbol, sector: input.sector, sectorGroup: group,
    latestPeriod: latest?.period ?? null, periods: reports.map((r) => r.period),
    metrics: metrics.filter((m) => m.value != null || m.reported != null), byKey, growth,
    dividend: { latestYear: ld?.fiscalYear ?? null, cashPct: ld?.cashPct ?? null, bonusPct: ld?.bonusPct ?? null, cashYieldPct: r2(cashYield), yearsPaidLast5: yearsPaid, history: divs },
    score: { overall, components: comps, sectorGroup: group, model },
    redFlags, strengths, dataNotes,
  };
}

function fyIndex(fy: string) { return parseInt(fy.slice(0, 4), 10); }
function pctChange(a: number | null, b: number | null) { return a == null || b == null || b === 0 ? null : r2(((a - b) / Math.abs(b)) * 100); }

// ---------- Valuation models (pure functions, used by calculators and AI) ----------

export function grahamNumber(eps: number, bvps: number) { return eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : null; }

/** Gordon growth dividend discount model. d0 = last cash dividend per share (Rs.). */
export function dividendDiscount(d0: number, growth: number, requiredReturn: number) {
  if (requiredReturn <= growth) return null;
  return (d0 * (1 + growth)) / (requiredReturn - growth);
}

/** Two-stage earnings/FCF DCF per share. */
export function dcf(params: { cashFlow0: number; growthYears: number; growthRate: number; terminalGrowth: number; discountRate: number }) {
  const { cashFlow0, growthYears, growthRate, terminalGrowth, discountRate } = params;
  if (discountRate <= terminalGrowth) return null;
  let pv = 0;
  let cf = cashFlow0;
  const rows: { year: number; cashFlow: number; pv: number }[] = [];
  for (let y = 1; y <= growthYears; y++) {
    cf *= 1 + growthRate;
    const p = cf / Math.pow(1 + discountRate, y);
    pv += p;
    rows.push({ year: y, cashFlow: cf, pv: p });
  }
  const terminal = (cf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvTerminal = terminal / Math.pow(1 + discountRate, growthYears);
  return { value: pv + pvTerminal, pvExplicit: pv, pvTerminal, terminalShare: pvTerminal / (pv + pvTerminal), rows };
}
