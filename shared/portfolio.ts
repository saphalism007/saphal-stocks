// Portfolio accounting for NEPSE holdings. Uses weighted average cost (WACC),
// the method CDSC/Mero Share and brokers use for capital-gains tax.
// Bonus shares enter at Rs. 100 per share by default (tax is paid on face
// value), right shares at their issue price; both are editable per entry.
import { buyCost, sellCost, cgtRate, DEFAULT_FEES, type FeeConfig } from "./costs.ts";

export type TxType = "buy" | "sell" | "ipo" | "right" | "bonus" | "cash_dividend" | "merger_in" | "merger_out";

export interface Transaction {
  id?: number;
  symbol: string;
  type: TxType;
  date: string; // YYYY-MM-DD
  quantity: number;
  price: number; // per share (for cash_dividend: total cash amount received before tax, in Rs.)
  commission?: number | null; // override auto broker commission
  otherCharges?: number | null; // override SEBON fee + DP etc.
  tax?: number | null; // CGT withheld (sell) or dividend tax
  notes?: string | null;
}

export interface Holding {
  symbol: string;
  quantity: number;
  wacc: number; // cost per share including buy charges
  costBasis: number;
  realizedPnl: number; // after sell charges and CGT
  dividendsReceived: number; // net of tax
  firstBuyDate: string | null;
  lastPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  estSellCharges: number | null;
  estCgt: number | null;
  netIfSoldToday: number | null; // after charges and CGT
  lots: { date: string; qty: number; costPerShare: number }[];
}

export interface PortfolioSummary {
  holdings: Holding[];
  invested: number; // current cost basis of open positions
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dividends: number;
  totalReturn: number; // realized + unrealized + dividends
  totalReturnPct: number | null; // vs total ever invested (cash in)
  cashIn: number; // sum of buy outflows
  cashOut: number; // sum of sell inflows + dividends
  missingPrices: string[];
}

export function chargesFor(tx: Transaction, cfg: FeeConfig = DEFAULT_FEES) {
  if (tx.type === "buy") {
    const c = buyCost(tx.quantity, tx.price, cfg);
    const commission = tx.commission ?? c.commission;
    const other = tx.otherCharges ?? c.sebonFee;
    return { commission, other, total: commission + other };
  }
  if (tx.type === "sell") {
    const c = sellCost(tx.quantity, tx.price, cfg);
    const commission = tx.commission ?? c.commission;
    const other = tx.otherCharges ?? c.sebonFee + c.dpCharge;
    return { commission, other, total: commission + other };
  }
  const other = tx.otherCharges ?? 0;
  return { commission: tx.commission ?? 0, other, total: (tx.commission ?? 0) + other };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function computeHoldings(txs: Transaction[], prices: Record<string, number | null>, cfg: FeeConfig = DEFAULT_FEES, today = new Date().toISOString().slice(0, 10)): PortfolioSummary {
  const sorted = [...txs].sort((a, b) => (a.date === b.date ? (a.id ?? 0) - (b.id ?? 0) : a.date < b.date ? -1 : 1));
  const map = new Map<string, Holding & { _cashIn: number }>();
  let cashIn = 0;
  let cashOut = 0;
  const get = (s: string) => {
    let h = map.get(s);
    if (!h) {
      h = { symbol: s, quantity: 0, wacc: 0, costBasis: 0, realizedPnl: 0, dividendsReceived: 0, firstBuyDate: null, lastPrice: null, marketValue: null, unrealizedPnl: null, unrealizedPct: null, estSellCharges: null, estCgt: null, netIfSoldToday: null, lots: [], _cashIn: 0 };
      map.set(s, h);
    }
    return h;
  };
  for (const tx of sorted) {
    const h = get(tx.symbol);
    const ch = chargesFor(tx, cfg);
    switch (tx.type) {
      case "buy":
      case "ipo":
      case "right":
      case "bonus":
      case "merger_in": {
        const cost = tx.quantity * tx.price + ch.total;
        h.costBasis += cost;
        h.quantity += tx.quantity;
        h.wacc = h.quantity ? h.costBasis / h.quantity : 0;
        if (!h.firstBuyDate) h.firstBuyDate = tx.date;
        h.lots.push({ date: tx.date, qty: tx.quantity, costPerShare: tx.quantity ? cost / tx.quantity : 0 });
        if (tx.type !== "bonus") { cashIn += cost; h._cashIn += cost; }
        if (tx.type === "bonus" && tx.tax) { cashIn += tx.tax; h._cashIn += tx.tax; } // 5% tax paid on bonus face value
        break;
      }
      case "sell":
      case "merger_out": {
        const q = Math.min(tx.quantity, h.quantity);
        if (q <= 0) break;
        const proceeds = q * tx.price - ch.total;
        const basis = h.wacc * q;
        // CGT: use recorded tax if given, else estimate from holding period of earliest remaining lot (FIFO for holding period only).
        let tax = tx.tax;
        if (tax == null && tx.type === "sell") {
          const firstLot = h.lots.find((l) => l.qty > 0);
          const hd = firstLot ? daysBetween(firstLot.date, tx.date) : 0;
          const gain = proceeds - basis;
          tax = gain > 0 ? gain * cgtRate(hd, "individual", cfg) : 0;
        }
        h.realizedPnl += proceeds - basis - (tax ?? 0);
        h.costBasis -= basis;
        h.quantity -= q;
        if (h.quantity === 0) h.costBasis = 0;
        // Consume lots FIFO (holding-period tracking).
        let left = q;
        for (const l of h.lots) { if (!left) break; const take = Math.min(l.qty, left); l.qty -= take; left -= take; }
        h.lots = h.lots.filter((l) => l.qty > 0);
        cashOut += proceeds - (tax ?? 0);
        break;
      }
      case "cash_dividend": {
        const net = tx.price - (tx.tax ?? tx.price * cfg.dividendTax);
        h.dividendsReceived += net;
        cashOut += net;
        break;
      }
    }
  }
  const holdings: Holding[] = [];
  const missing: string[] = [];
  for (const h of map.values()) {
    const p = prices[h.symbol] ?? null;
    h.lastPrice = p;
    if (h.quantity > 0) {
      if (p == null) missing.push(h.symbol);
      else {
        h.marketValue = h.quantity * p;
        h.unrealizedPnl = h.marketValue - h.costBasis;
        h.unrealizedPct = h.costBasis ? (h.unrealizedPnl / h.costBasis) * 100 : null;
        const sc = sellCost(h.quantity, p, cfg);
        h.estSellCharges = sc.total;
        const firstLot = h.lots[0];
        const hd = firstLot ? daysBetween(firstLot.date, today) : 0;
        const gain = sc.net - h.costBasis;
        h.estCgt = gain > 0 ? gain * cgtRate(hd, "individual", cfg) : 0;
        h.netIfSoldToday = sc.net - h.estCgt;
      }
    }
    const { _cashIn, ...rest } = h;
    void _cashIn;
    holdings.push(rest);
  }
  const open = holdings.filter((h) => h.quantity > 0);
  const invested = open.reduce((s, h) => s + h.costBasis, 0);
  const marketValue = open.reduce((s, h) => s + (h.marketValue ?? h.costBasis), 0);
  const unrealized = open.reduce((s, h) => s + (h.unrealizedPnl ?? 0), 0);
  const realized = holdings.reduce((s, h) => s + h.realizedPnl, 0);
  const dividends = holdings.reduce((s, h) => s + h.dividendsReceived, 0);
  const totalReturn = realized + unrealized + dividends;
  return {
    holdings: holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    invested, marketValue, unrealizedPnl: unrealized, realizedPnl: realized, dividends, totalReturn,
    totalReturnPct: cashIn ? (totalReturn / cashIn) * 100 : null, cashIn, cashOut, missingPrices: missing,
  };
}

export interface HealthReport {
  score: number;
  diversification: { holdings: number; topWeightPct: number; top3WeightPct: number; sectorCount: number; hhi: number };
  sectorExposure: { sector: string; weightPct: number; value: number }[];
  issues: string[];
  positives: string[];
}

export function portfolioHealth(summary: PortfolioSummary, sectors: Record<string, string>, extras: Record<string, { fundamentalScore: number | null; technicalScore: number | null; volatility: number | null }>): HealthReport {
  const open = summary.holdings.filter((h) => h.quantity > 0);
  const total = open.reduce((s, h) => s + (h.marketValue ?? h.costBasis), 0) || 1;
  const weights = open.map((h) => ({ h, w: (h.marketValue ?? h.costBasis) / total })).sort((a, b) => b.w - a.w);
  const bySector = new Map<string, number>();
  for (const { h, w } of weights) bySector.set(sectors[h.symbol] || "Unknown", (bySector.get(sectors[h.symbol] || "Unknown") || 0) + w);
  const sectorExposure = [...bySector.entries()].map(([sector, w]) => ({ sector, weightPct: Math.round(w * 1000) / 10, value: Math.round(w * total) })).sort((a, b) => b.weightPct - a.weightPct);
  const hhi = weights.reduce((s, x) => s + x.w * x.w, 0);
  const issues: string[] = [];
  const positives: string[] = [];
  let score = 70;
  const top = weights[0]?.w ?? 0;
  const top3 = weights.slice(0, 3).reduce((s, x) => s + x.w, 0);
  if (open.length < 5) { issues.push(`Only ${open.length} holding(s): one bad stock can hurt the whole portfolio.`); score -= 10; }
  else if (open.length > 25) issues.push(`${open.length} holdings: hard to track; consider consolidating into your best ideas.`);
  else positives.push(`${open.length} holdings is a manageable, diversified number.`);
  if (top > 0.25) { issues.push(`${weights[0].h.symbol} is ${(top * 100).toFixed(0)}% of the portfolio (above 25%).`); score -= 10; }
  const topSector = sectorExposure[0];
  if (topSector && topSector.weightPct > 40) { issues.push(`${topSector.weightPct}% in ${topSector.sector}: sector concentration risk (policy or interest-rate changes hit the whole sector).`); score -= 10; }
  else if (sectorExposure.length >= 4) { positives.push(`Spread across ${sectorExposure.length} sectors.`); score += 5; }
  let fs = 0, fn = 0;
  for (const { h, w } of weights) {
    const e = extras[h.symbol];
    if (e?.fundamentalScore != null) { fs += e.fundamentalScore * w; fn += w; }
    if (e?.fundamentalScore != null && e.fundamentalScore < 35 && w > 0.05) issues.push(`${h.symbol} (${(w * 100).toFixed(0)}% weight) has weak fundamentals (score ${e.fundamentalScore}).`);
    if (e?.technicalScore != null && e.technicalScore < 30 && w > 0.05) issues.push(`${h.symbol} is in a weak technical position (score ${e.technicalScore}).`);
    if (h.unrealizedPct != null && h.unrealizedPct < -25) issues.push(`${h.symbol} is down ${Math.abs(h.unrealizedPct).toFixed(0)}% from your cost: review the original thesis.`);
  }
  if (fn > 0) {
    const avgF = fs / fn;
    score += Math.round((avgF - 50) / 4);
    (avgF >= 55 ? positives : issues).push(`Weighted fundamental score ${avgF.toFixed(0)}/100.`);
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    diversification: { holdings: open.length, topWeightPct: Math.round(top * 1000) / 10, top3WeightPct: Math.round(top3 * 1000) / 10, sectorCount: sectorExposure.length, hhi: Math.round(hhi * 1000) / 1000 },
    sectorExposure, issues, positives,
  };
}

/** Position sizing: risk a fixed % of capital between entry and stop. */
export function positionSize(capital: number, riskPct: number, entry: number, stop: number, cfg: FeeConfig = DEFAULT_FEES) {
  const perShareRisk = entry - stop;
  if (perShareRisk <= 0) return null;
  const riskAmount = capital * (riskPct / 100);
  let qty = Math.floor(riskAmount / perShareRisk);
  // Cap by capital available including charges.
  while (qty > 0 && buyCost(qty, entry, cfg).net > capital) qty--;
  const cost = buyCost(qty, entry, cfg);
  return { quantity: qty, positionValue: cost.amount, totalCost: cost.net, riskAmount: qty * perShareRisk, positionPctOfCapital: (cost.net / capital) * 100 };
}
