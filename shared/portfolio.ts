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
  realizedEvents: RealizedEvent[];
  dividendEvents: DividendEvent[];
}

export interface RealizedEvent { date: string; symbol: string; qty: number; proceeds: number; costBasis: number; gain: number; tax: number; holdingDays: number; taxEstimated: boolean }
export interface DividendEvent { date: string; symbol: string; gross: number; tax: number; net: number }

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
  const realizedEvents: RealizedEvent[] = [];
  const dividendEvents: DividendEvent[] = [];
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
        const firstLot = h.lots.find((l) => l.qty > 0);
        const hd = firstLot ? daysBetween(firstLot.date, tx.date) : 0;
        const estimated = tax == null;
        if (tax == null && tx.type === "sell") {
          const gain = proceeds - basis;
          tax = gain > 0 ? gain * cgtRate(hd, "individual", cfg) : 0;
        }
        h.realizedPnl += proceeds - basis - (tax ?? 0);
        realizedEvents.push({ date: tx.date, symbol: tx.symbol, qty: q, proceeds, costBasis: basis, gain: proceeds - basis, tax: tax ?? 0, holdingDays: hd, taxEstimated: estimated });
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
        const dtax = tx.tax ?? tx.price * cfg.dividendTax;
        const net = tx.price - dtax;
        h.dividendsReceived += net;
        dividendEvents.push({ date: tx.date, symbol: tx.symbol, gross: tx.price, tax: dtax, net });
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
    totalReturnPct: cashIn ? (totalReturn / cashIn) * 100 : null, cashIn, cashOut, missingPrices: missing, realizedEvents, dividendEvents,
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

// ---------- performance over time ----------

export interface TimelinePoint { date: string; value: number; netInvested: number; twrIndex: number; benchmark: number | null }

/**
 * Daily portfolio value from transactions and (unadjusted) closing prices, with a
 * time-weighted return index (cash flows removed) and an optional benchmark rebased to 100.
 * prices: symbol -> sorted [date, close][]; dates: trading days to evaluate.
 */
export function portfolioTimeline(txs: Transaction[], prices: Record<string, [string, number][]>, dates: string[], benchmark?: Record<string, number>, cfg: FeeConfig = DEFAULT_FEES): TimelinePoint[] {
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id ?? 0) - (b.id ?? 0)));
  if (!sorted.length) return [];
  const start = sorted[0].date;
  const days = dates.filter((d) => d >= start);
  const qty: Record<string, number> = {};
  const ptr: Record<string, number> = {};
  const last: Record<string, number> = {};
  let ti = 0;
  let netInvested = 0;
  let prevValue = 0;
  let twr = 100;
  let bench0: number | null = null;
  const out: TimelinePoint[] = [];
  for (const d of days) {
    let inflow = 0, outflow = 0;
    while (ti < sorted.length && sorted[ti].date <= d) {
      const t = sorted[ti++];
      const ch = chargesFor(t, cfg);
      if (["buy", "ipo", "right", "merger_in"].includes(t.type)) { qty[t.symbol] = (qty[t.symbol] ?? 0) + t.quantity; inflow += t.quantity * t.price + ch.total; if (!last[t.symbol]) last[t.symbol] = t.price; }
      else if (t.type === "bonus") qty[t.symbol] = (qty[t.symbol] ?? 0) + t.quantity;
      else if (t.type === "sell" || t.type === "merger_out") { const q = Math.min(t.quantity, qty[t.symbol] ?? 0); qty[t.symbol] = (qty[t.symbol] ?? 0) - q; outflow += q * t.price - ch.total - (t.tax ?? 0); }
      else if (t.type === "cash_dividend") outflow += t.price - (t.tax ?? t.price * cfg.dividendTax);
    }
    let value = 0;
    for (const [sym, q] of Object.entries(qty)) {
      if (!q) continue;
      const series = prices[sym] || [];
      let i = ptr[sym] ?? 0;
      while (i < series.length && series[i][0] <= d) { last[sym] = series[i][1]; i++; }
      ptr[sym] = i;
      value += q * (last[sym] ?? 0);
    }
    netInvested += inflow - outflow;
    // Flows at the start of the day: money added is invested at today's prices, so buy-day gains/losses and fees count.
    if (prevValue + inflow > 0) twr *= (value + outflow) / (prevValue + inflow);
    prevValue = value;
    const b = benchmark?.[d];
    if (b != null && bench0 == null) bench0 = b;
    out.push({ date: d, value: Math.round(value), netInvested: Math.round(netInvested), twrIndex: Math.round(twr * 100) / 100, benchmark: b != null && bench0 ? Math.round((b / bench0) * 10000) / 100 : null });
  }
  return out;
}

/** Nepali fiscal year label (e.g. "2082/83") for an AD date. FY starts on Shrawan 1 (about 16-17 July); the start day is configurable. */
export function nepaliFiscalYear(date: string, fyStart = "07-16"): string {
  const y = Number(date.slice(0, 4));
  const startY = date.slice(5) >= fyStart ? y : y - 1;
  const bs = startY + 57; // AD year in which Shrawan starts + 57 = BS year
  return `${bs}/${String((bs + 1) % 100).padStart(2, "0")}`;
}

// ---------- Rebalancing ----------

export interface RebalanceTrade { symbol: string; side: "buy" | "sell"; qty: number; price: number; amount: number; charges: number; estCgt: number; fromWeightPct: number; toWeightPct: number }

/**
 * Trades needed to move from current holdings to target weights (percent of
 * portfolio value after adding `cashToAdd`). Uses whole shares, Nepal charges, and
 * estimated CGT on sells (from the earliest remaining lot's holding period).
 * Trades smaller than `minTradeRs` are skipped to avoid paying minimum commissions for tiny changes.
 */
export function rebalancePlan(holdings: Holding[], targets: Record<string, number>, prices: Record<string, number | null>, cashToAdd = 0, cfg: FeeConfig = DEFAULT_FEES, today = new Date().toISOString().slice(0, 10), minTradeRs = 5000) {
  const open = holdings.filter((h) => h.quantity > 0);
  const priceOf = (s: string) => prices[s] ?? open.find((h) => h.symbol === s)?.lastPrice ?? null;
  const current = open.reduce((t, h) => t + h.quantity * (priceOf(h.symbol) ?? h.wacc), 0);
  const total = current + cashToAdd;
  const sumT = Object.values(targets).reduce((a, b) => a + (b || 0), 0);
  const warnings: string[] = [];
  if (Math.abs(sumT - 100) > 0.5) warnings.push(`Target weights add up to ${sumT.toFixed(1)}%; the remaining ${(100 - sumT).toFixed(1)}% stays in cash.`);
  const symbols = new Set([...open.map((h) => h.symbol), ...Object.keys(targets)]);
  const trades: RebalanceTrade[] = [];
  let cash = cashToAdd;
  // Sells first (they fund the buys).
  const sells: RebalanceTrade[] = [], buys: RebalanceTrade[] = [];
  for (const s of symbols) {
    const p = priceOf(s);
    if (!p) { warnings.push(`No price for ${s}; skipped.`); continue; }
    const h = open.find((x) => x.symbol === s);
    const curQty = h?.quantity ?? 0;
    const targetValue = (total * (targets[s] ?? 0)) / 100;
    const diffQty = Math.trunc((targetValue - curQty * p) / p);
    if (!diffQty || Math.abs(diffQty * p) < minTradeRs) continue;
    const fromW = total ? ((curQty * p) / total) * 100 : 0;
    const toW = total ? (((curQty + diffQty) * p) / total) * 100 : 0;
    if (diffQty < 0) {
      const q = Math.min(-diffQty, curQty);
      const sc = sellCost(q, p, cfg);
      const gain = sc.net - (h ? h.wacc * q : 0);
      const hd = h?.lots[0] ? daysBetween(h.lots[0].date, today) : 0;
      const tax = gain > 0 ? gain * cgtRate(hd, "individual", cfg) : 0;
      sells.push({ symbol: s, side: "sell", qty: q, price: p, amount: q * p, charges: sc.total, estCgt: tax, fromWeightPct: fromW, toWeightPct: toW });
      cash += sc.net - tax;
    } else buys.push({ symbol: s, side: "buy", qty: diffQty, price: p, amount: diffQty * p, charges: buyCost(diffQty, p, cfg).total, estCgt: 0, fromWeightPct: fromW, toWeightPct: toW });
  }
  trades.push(...sells);
  // Scale buys down if cash is short (after charges).
  const need = buys.reduce((t, b) => t + b.amount + b.charges, 0);
  const scale = need > cash && need > 0 ? cash / need : 1;
  if (scale < 1) warnings.push(`Not enough cash for all buys after sells and taxes; buys scaled to ${(scale * 100).toFixed(0)}%.`);
  for (const b of buys) {
    let q = Math.floor(b.qty * scale);
    while (q > 0 && buyCost(q, b.price, cfg).net > cash) q--;
    if (q <= 0) continue;
    const bc = buyCost(q, b.price, cfg);
    cash -= bc.net;
    trades.push({ ...b, qty: q, amount: q * b.price, charges: bc.total, toWeightPct: total ? ((b.fromWeightPct / 100) * total + q * b.price) / total * 100 : 0 });
  }
  return {
    portfolioValue: current, total, trades,
    totals: { charges: trades.reduce((t, x) => t + x.charges, 0), estCgt: trades.reduce((t, x) => t + x.estCgt, 0), turnover: trades.reduce((t, x) => t + x.amount, 0), cashLeft: cash },
    warnings,
  };
}
