// Nepal secondary-market costs and taxes. All rates live in one editable
// config (Settings -> Fees & taxes) because SEBON, CDSC and the annual budget
// change them. Defaults below reflect the published schedule as we understood
// it when this was written; the app shows `verifiedOn` and asks the user to
// re-check against SEBON / NEPSE / IRD notices.

export interface CommissionSlab { upTo: number | null; rate: number } // rate as a fraction

export interface FeeConfig {
  verifiedOn: string;
  commissionSlabs: CommissionSlab[];
  minCommission: number; // Rs.
  sebonFeeRate: number; // fraction of transaction value
  dpChargePerScrip: number; // Rs., CDSC/DP transfer charge per company per settlement
  dpOnBuy?: boolean; // the DP charge also applies to purchases (CDSC clearing FAQ); true by default
  nameTransferFee: number; // Rs., not applied by default
  cgtShortTerm: number; // individuals, held <= 365 days
  cgtLongTerm: number; // individuals, held > 365 days
  cgtInstitution: number;
  dividendTax: number; // final withholding on cash + bonus dividends
  holdingDaysForLongTerm: number;
  notes: string[];
}

export const DEFAULT_FEES: FeeConfig = {
  verifiedOn: "2026-11-18",
  commissionSlabs: [
    { upTo: 50_000, rate: 0.0036 },
    { upTo: 500_000, rate: 0.0033 },
    { upTo: 2_000_000, rate: 0.0031 },
    { upTo: 10_000_000, rate: 0.0027 },
    { upTo: null, rate: 0.0024 },
  ],
  minCommission: 10,
  sebonFeeRate: 0.00015,
  dpChargePerScrip: 25,
  dpOnBuy: true,
  nameTransferFee: 5,
  cgtShortTerm: 0.05, // from 22 Sep 2026 (Nepal Gazette): 5% if held 365 days or less
  cgtLongTerm: 0.0375, // and 3.75% if held longer
  cgtInstitution: 0.1,
  dividendTax: 0.05,
  holdingDaysForLongTerm: 365,
  notes: [
    "Broker commission is charged on the whole transaction value at the slab rate for that value, with a Rs. 10 minimum.",
    "SEBON regulatory fee: 0.015% of transaction value, on both buy and sell.",
    "DP charge: Rs. 25 per company per settlement, on purchases and on sales (CDSC clearing and settlement FAQ). Several purchases of the same company settled together pay it once.",
    "Capital gains tax for resident individuals on listed shares: 5% if held 365 days or less, 3.75% if held longer, from 22 September 2026 (Cabinet decision published in the Nepal Gazette). From 17 July to 21 September 2026 it was 10% / 7.5%; before that 7.5% / 5%. Each sale uses the rate in force on its date. Deducted at settlement.",
    "Dividend tax: 5% final withholding on cash dividend and on bonus shares (on face value).",
    "Rates change with SEBON directives and the annual budget. Verify on sebon.gov.np, nepalstock.com and ird.gov.np.",
  ],
};

export function brokerCommission(amount: number, cfg: FeeConfig = DEFAULT_FEES): number {
  if (amount <= 0) return 0;
  const slab = cfg.commissionSlabs.find((s) => s.upTo == null || amount <= s.upTo) || cfg.commissionSlabs[cfg.commissionSlabs.length - 1];
  return Math.max(cfg.minCommission, amount * slab.rate);
}

export interface TradeCost {
  amount: number;
  commission: number;
  sebonFee: number;
  dpCharge: number;
  total: number; // all charges
  net: number; // buy: amount + charges; sell: amount - charges (before CGT)
}

export function buyCost(qty: number, price: number, cfg: FeeConfig = DEFAULT_FEES): TradeCost {
  const amount = qty * price;
  const commission = brokerCommission(amount, cfg);
  const sebonFee = amount * cfg.sebonFeeRate;
  const dpCharge = cfg.dpOnBuy === false ? 0 : cfg.dpChargePerScrip;
  const total = commission + sebonFee + dpCharge;
  return { amount, commission, sebonFee, dpCharge, total, net: amount + total };
}

export function sellCost(qty: number, price: number, cfg: FeeConfig = DEFAULT_FEES): TradeCost {
  const amount = qty * price;
  const commission = brokerCommission(amount, cfg);
  const sebonFee = amount * cfg.sebonFeeRate;
  const dpCharge = cfg.dpChargePerScrip;
  const total = commission + sebonFee + dpCharge;
  return { amount, commission, sebonFee, dpCharge, total, net: amount - total };
}

/** Capital gains tax for resident individuals on listed shares, by the date of sale. */
export const CGT_SCHEDULE: { from: string; short: number; long: number; basis: string }[] = [
  { from: "0000-00-00", short: 0.075, long: 0.05, basis: "Until FY 2082/83" },
  { from: "2026-07-17", short: 0.1, long: 0.075, basis: "Finance Act 2083 (FY 2083/84)" },
  { from: "2026-09-22", short: 0.05, long: 0.0375, basis: "Cabinet decision, Nepal Gazette 22 Sep 2026" },
];
/** Kept for older callers: the date the FY 2083/84 rates began. */
export const CGT_CHANGE_DATE = "2026-07-17";
export const cgtScheduleOn = (date: string) => [...CGT_SCHEDULE].reverse().find((r) => date >= r.from) ?? CGT_SCHEDULE[0];
/** True when the configured rates are one of the official schedules (not rates the user typed in Settings). */
export const isOfficialCgt = (cfg: FeeConfig) => CGT_SCHEDULE.some((r) => r.short === cfg.cgtShortTerm && r.long === cfg.cgtLongTerm);

export function cgtRate(holdingDays: number, investor: "individual" | "institution" = "individual", cfg: FeeConfig = DEFAULT_FEES, saleDate?: string) {
  if (investor === "institution") return cfg.cgtInstitution;
  const long = holdingDays > cfg.holdingDaysForLongTerm;
  // Each sale uses the rate in force on its date, unless you set your own rates in Settings.
  if (isOfficialCgt(cfg)) { const r = cgtScheduleOn(saleDate ?? new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10)); return long ? r.long : r.short; }
  return long ? cfg.cgtLongTerm : cfg.cgtShortTerm;
}

export interface RoundTrip {
  buy: TradeCost;
  sell: TradeCost;
  costBasis: number; // WACC basis = buy amount + buy charges
  grossGain: number; // sell net - cost basis
  cgt: number;
  netProfit: number;
  netReturnPct: number;
  breakevenPrice: number; // sell price needed to cover all costs (before CGT)
}

export function roundTrip(qty: number, buyPrice: number, sellPrice: number, holdingDays: number, cfg: FeeConfig = DEFAULT_FEES): RoundTrip {
  const buy = buyCost(qty, buyPrice, cfg);
  const sell = sellCost(qty, sellPrice, cfg);
  const costBasis = buy.net;
  const grossGain = sell.net - costBasis;
  const cgt = grossGain > 0 ? grossGain * cgtRate(holdingDays, "individual", cfg) : 0;
  const netProfit = grossGain - cgt;
  // Breakeven: solve sell.net(p) = costBasis by bisection (slabs make it piecewise).
  let lo = buyPrice * 0.9;
  let hi = buyPrice * 1.2 + 50;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sellCost(qty, mid, cfg).net < costBasis) lo = mid; else hi = mid;
  }
  return { buy, sell, costBasis, grossGain, cgt, netProfit, netReturnPct: (netProfit / costBasis) * 100, breakevenPrice: hi };
}

/** Approximate one-way cost as a fraction (used by the backtester). */
export function oneWayCostFraction(amount: number, side: "buy" | "sell", cfg: FeeConfig = DEFAULT_FEES) {
  const c = brokerCommission(amount, cfg) + amount * cfg.sebonFeeRate + (side === "sell" || cfg.dpOnBuy !== false ? cfg.dpChargePerScrip : 0);
  return c / amount;
}
