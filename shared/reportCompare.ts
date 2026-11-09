// Financial report comparison: the same key figures pulled from each stored quarterly statement so
// two or more reports (same company over time, or different companies) can be compared side by side.
// Values are exactly as reported (Rs. '000 unless noted); nothing is estimated. Pure; tested.

export interface ReportItem { statement: string; label: string; value: number | null }
export interface CompareMetric { key: string; label: string; unit: "Rs. '000" | "Rs." | "%" | "x"; higherIsBetter: boolean | null }
export const COMPARE_METRICS: CompareMetric[] = [
  { key: "revenue", label: "Revenue / total operating income", unit: "Rs. '000", higherIsBetter: true },
  { key: "nii", label: "Net interest income", unit: "Rs. '000", higherIsBetter: true },
  { key: "operatingProfit", label: "Operating profit", unit: "Rs. '000", higherIsBetter: true },
  { key: "netProfit", label: "Net profit (period to date)", unit: "Rs. '000", higherIsBetter: true },
  { key: "eps", label: "EPS (annualised, as reported)", unit: "Rs.", higherIsBetter: true },
  { key: "bvps", label: "Net worth per share", unit: "Rs.", higherIsBetter: true },
  { key: "shareCapital", label: "Share / paid-up capital", unit: "Rs. '000", higherIsBetter: null },
  { key: "reserves", label: "Reserves (incl. retained earnings)", unit: "Rs. '000", higherIsBetter: true },
  { key: "equity", label: "Total equity", unit: "Rs. '000", higherIsBetter: true },
  { key: "liabilities", label: "Total liabilities", unit: "Rs. '000", higherIsBetter: null },
  { key: "assets", label: "Total assets", unit: "Rs. '000", higherIsBetter: true },
  { key: "deposits", label: "Deposits from customers", unit: "Rs. '000", higherIsBetter: true },
  { key: "loans", label: "Loans to customers", unit: "Rs. '000", higherIsBetter: true },
  { key: "npl", label: "NPL to total loans", unit: "%", higherIsBetter: false },
  { key: "car", label: "Capital adequacy (capital fund to RWA)", unit: "%", higherIsBetter: true },
  { key: "cd", label: "Credit to deposit ratio", unit: "%", higherIsBetter: null },
  { key: "roe", label: "Return on equity (as reported)", unit: "%", higherIsBetter: true },
  { key: "debt", label: "Loans & long-term liabilities", unit: "Rs. '000", higherIsBetter: false },
];

const pick = (items: ReportItem[], st: string | string[], pats: RegExp[], not?: RegExp) => {
  const sts = Array.isArray(st) ? st : [st];
  for (const p of pats) { const it = items.find((i) => sts.includes(i.statement) && p.test(i.label.trim()) && !(not && not.test(i.label)) && i.value != null); if (it) return it.value as number; }
  return null;
};

export function compareFigures(items: ReportItem[]): Record<string, number | null> {
  const retained = pick(items, "balance_sheet", [/^retained earnings/i]);
  const reserveLine = pick(items, "balance_sheet", [/^reserves?$/i, /^reserve ?& ?surplus/i, /^reserves? and surplus/i, /^reserve fund/i]);
  const equity = pick(items, "balance_sheet", [/^total (shareholders'? )?equity$/i, /^total equity/i, /shareholders'? fund/i], /liabilities/i);
  const shareCapital = pick(items, "balance_sheet", [/^share capital$/i, /^paid ?up capital/i]);
  const liabilities = pick(items, "balance_sheet", [/^total liabilities$/i, /^total current liabilities/i]);
  const assets = pick(items, "balance_sheet", [/^total assets/i, /^application of fund/i]);
  return {
    revenue: pick(items, "income", [/^total operating income/i, /^operating income/i, /^total income/i, /^gross earned premium/i, /^total revenue/i, /^revenue/i, /^sales/i]),
    nii: pick(items, "income", [/^net interest income/i]),
    operatingProfit: pick(items, "income", [/^operating profit/i, /^profit from operation/i]),
    netProfit: pick(items, "income", [/^profit for the (period|year)/i, /^net profit\s*\/?\s*\(?loss\)? for the (year|period)/i, /^net profit\b(?!.*before)/i, /profit.*after tax/i], /before|margin|share of|to /i),
    eps: pick(items, "metrics", [/annuali[sz]ed eps/i, /earnings per share.*annuali/i, /^basic earnings per share/i, /^eps/i, /earnings per share/i]),
    bvps: pick(items, "metrics", [/net ?worth per share/i, /book value per share/i]),
    shareCapital,
    reserves: retained != null || reserveLine != null ? (retained ?? 0) + (reserveLine ?? 0) : null,
    equity, liabilities, assets,
    deposits: pick(items, "balance_sheet", [/^deposits? from customers/i, /^deposits?$/i]),
    loans: pick(items, "balance_sheet", [/^loans? and advances to customers/i, /^loans? and advances$/i]),
    npl: pick(items, "metrics", [/non.?performing loan/i], /provision/i),
    car: pick(items, "metrics", [/capital fund to rwa/i, /capital adequacy/i]),
    cd: pick(items, "metrics", [/credit to deposit/i, /\bcd ratio/i]),
    roe: pick(items, "metrics", [/^return on equity/i]),
    debt: pick(items, "balance_sheet", [/^loans? ?& ?long.?term liabilities/i, /^borrowings?$/i, /^long.?term loans?/i]),
  };
}

/** % change from a to b (null if either missing or a is zero). */
export const changePct = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 10000) / 100);
