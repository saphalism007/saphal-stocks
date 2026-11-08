import { all, get } from "../db.ts";
import { computeHoldings, portfolioHealth, type Transaction } from "../../shared/portfolio.ts";
import * as M from "./market.ts";

export function txsFor(portfolioId: number): Transaction[] {
  return all<{ id: number; symbol: string; type: Transaction["type"]; date: string; quantity: number; price: number; commission: number | null; other_charges: number | null; tax: number | null; notes: string | null }>(
    "SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY date, id", portfolioId,
  ).map((t) => ({ id: t.id, symbol: t.symbol, type: t.type, date: t.date, quantity: t.quantity, price: t.price, commission: t.commission, otherCharges: t.other_charges, tax: t.tax, notes: t.notes }));
}

export function latestPrices(symbols: string[]) {
  const out: Record<string, number | null> = {};
  for (const s of symbols) {
    const q = get<{ close: number }>("SELECT close FROM quotes WHERE symbol = ?", s) ?? get<{ close: number }>("SELECT close FROM prices WHERE symbol = ? ORDER BY date DESC LIMIT 1", s);
    out[s] = q?.close ?? null;
  }
  return out;
}

export function portfolioSummary(portfolioId: number) {
  const txs = txsFor(portfolioId);
  const prices = latestPrices([...new Set(txs.map((t) => t.symbol))]);
  const summary = computeHoldings(txs, prices, M.fees());
  const syms = summary.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);
  const sectors: Record<string, string> = {};
  for (const s of syms) sectors[s] = (get<{ sector: string }>("SELECT sector FROM companies WHERE symbol = ?", s)?.sector) || "Unknown";
  const factors = new Map(M.allFactors().map((f) => [f.symbol, f]));
  const extras: Record<string, { fundamentalScore: number | null; technicalScore: number | null; volatility: number | null }> = {};
  for (const s of syms) { const f = factors.get(s); extras[s] = { fundamentalScore: f?.fundamentalScore ?? null, technicalScore: f?.technicalScore ?? null, volatility: f?.volatility ?? null }; }
  const health = syms.length ? portfolioHealth(summary, sectors, extras) : null;
  return { summary, health, sectors, extras, priceDate: M.latestTradingDate(), transactions: txs };
}

export function portfolioData(userId: number, portfolioId?: number) {
  const ports = all<{ id: number; name: string; kind: string; strategy: string | null }>("SELECT id, name, kind, strategy FROM portfolios WHERE user_id = ? ORDER BY id", userId);
  if (!ports.length) return { portfolios: [], note: "The user has not created any portfolio yet." };
  const target = portfolioId ? ports.filter((p) => p.id === portfolioId) : ports;
  return {
    priceDate: M.latestTradingDate(),
    portfolios: target.map((p) => {
      const d = portfolioSummary(p.id);
      return {
        id: p.id, name: p.name, kind: p.kind, strategy: p.strategy,
        totals: { invested: d.summary.invested, marketValue: d.summary.marketValue, unrealizedPnl: d.summary.unrealizedPnl, realizedPnl: d.summary.realizedPnl, dividends: d.summary.dividends, totalReturnPct: d.summary.totalReturnPct },
        holdings: d.summary.holdings.filter((h) => h.quantity > 0).map((h) => ({ symbol: h.symbol, sector: d.sectors[h.symbol], qty: h.quantity, wacc: Math.round(h.wacc * 100) / 100, lastPrice: h.lastPrice, marketValue: h.marketValue, unrealizedPct: h.unrealizedPct != null ? Math.round(h.unrealizedPct * 10) / 10 : null, weightPct: d.summary.marketValue ? Math.round(((h.marketValue ?? h.costBasis) / d.summary.marketValue) * 1000) / 10 : null, firstBuy: h.firstBuyDate, ...d.extras[h.symbol] })),
        health: d.health, missingPrices: d.summary.missingPrices,
      };
    }),
  };
}
