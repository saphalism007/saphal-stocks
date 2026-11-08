// Reads market data from the database and runs the shared engines on it.
import { all, get, getSetting } from "../db.ts";
import type { Bar } from "../../shared/types.ts";
import { adjustForBonus } from "../../shared/adjust.ts";
import { generateSetups, technicalSnapshot } from "../../shared/signals.ts";
import { analyzeFundamentals, type QuarterReport, type FundamentalAnalysis } from "../../shared/fundamentals.ts";
import { annualisedVolatility, type StockFactors } from "../../shared/ranking.ts";
import { DEFAULT_FEES, type FeeConfig } from "../../shared/costs.ts";
import { sma } from "../../shared/indicators.ts";

export const fees = (): FeeConfig => ({ ...DEFAULT_FEES, ...getSetting<Partial<FeeConfig>>("fees", {}) });

export function rawBars(symbol: string, limit?: number): Bar[] {
  const rows = all<Bar>(
    `SELECT date, open, high, low, close, volume, amount FROM prices WHERE symbol = ? ORDER BY date ${limit ? "DESC LIMIT " + Number(limit) : "ASC"}`,
    symbol,
  );
  return limit ? rows.reverse() : rows;
}

export function bonusEvents(symbol: string) {
  return all<{ fiscal_year: string; bonus_pct: number; bookclose_date: string }>(
    "SELECT fiscal_year, bonus_pct, bookclose_date FROM dividends WHERE symbol = ? AND bonus_pct > 0 AND bookclose_date IS NOT NULL", symbol,
  ).map((d) => ({ bookCloseDate: d.bookclose_date, bonusPct: d.bonus_pct, fiscalYear: d.fiscal_year }));
}

/** Bars adjusted for bonus issues (only where the gap is visible in the data). */
export function bars(symbol: string, opts: { adjusted?: boolean; limit?: number } = {}) {
  const raw = rawBars(symbol);
  const adj = opts.adjusted === false ? { bars: raw, applied: [], skipped: [] } : adjustForBonus(raw, bonusEvents(symbol));
  const out = opts.limit ? adj.bars.slice(-opts.limit) : adj.bars;
  return { bars: out, adjustments: adj.applied, skippedAdjustments: adj.skipped };
}

export function company(symbol: string) {
  return get<Record<string, unknown> & { symbol: string; name: string | null; sector: string | null; listed_shares: number | null; paid_up_value: number | null }>(
    "SELECT * FROM companies WHERE symbol = ?", symbol.toUpperCase(),
  );
}

export function quote(symbol: string) {
  return get<Record<string, number | string | null>>("SELECT * FROM quotes WHERE symbol = ?", symbol.toUpperCase());
}

export function reportsFor(symbol: string): QuarterReport[] {
  const reps = all<{ id: number; symbol: string; period: string; fiscal_year: string; quarter: number; source: string; fetched_at: string }>(
    "SELECT * FROM reports WHERE symbol = ? ORDER BY fiscal_year DESC, quarter DESC", symbol,
  );
  return reps.map((r) => ({
    symbol: r.symbol, period: r.period, fiscalYear: r.fiscal_year, quarter: r.quarter, source: r.source, fetchedAt: r.fetched_at,
    items: all<{ statement: "balance_sheet" | "income" | "metrics"; label: string; value: number | null }>("SELECT statement, label, value FROM report_items WHERE report_id = ? ORDER BY ord", r.id),
  }));
}

export function dividendsFor(symbol: string) {
  return all<{ fiscal_year: string; cash_pct: number | null; bonus_pct: number | null; bookclose_date: string | null; announcement_date: string | null }>(
    "SELECT * FROM dividends WHERE symbol = ? ORDER BY fiscal_year DESC", symbol,
  ).map((d) => ({ fiscalYear: d.fiscal_year, cashPct: d.cash_pct, bonusPct: d.bonus_pct, bookCloseDate: d.bookclose_date, announcementDate: d.announcement_date }));
}

export function fundamentalsFor(symbol: string): FundamentalAnalysis | null {
  const c = company(symbol);
  if (!c) return null;
  const q = quote(symbol);
  const lastBar = rawBars(symbol, 1)[0];
  const price = (q?.close as number) ?? lastBar?.close ?? null;
  return analyzeFundamentals({
    symbol, sector: c.sector || "", price, priceDate: (q?.date as string) ?? lastBar?.date ?? null,
    listedShares: c.listed_shares, faceValue: c.paid_up_value, reports: reportsFor(symbol), dividends: dividendsFor(symbol),
  });
}

export function analyzeStock(symbol: string) {
  const sym = symbol.toUpperCase();
  const c = company(sym);
  const b = bars(sym);
  const fa = fundamentalsFor(sym);
  const sig = generateSetups(b.bars, {
    symbol: sym, fees: fees(), fundamentalScore: fa?.score.overall ?? null,
    fundamentalNote: fa?.score.overall != null ? `Fundamental score ${fa.score.overall}/100 (${fa.sectorGroup} model, ${fa.latestPeriod}).` : "No financial statements stored yet.",
  });
  const lastBar = b.bars[b.bars.length - 1];
  return {
    symbol: sym, company: c, quote: quote(sym), lastBar, bars: b.bars.length, adjustments: b.adjustments, skippedAdjustments: b.skippedAdjustments,
    technical: sig.snapshot, levels: sig.levels, patterns: sig.patterns, setups: sig.setups, fundamentals: fa,
    dataFreshness: { lastPriceDate: lastBar?.date ?? null, latestReport: fa?.latestPeriod ?? null, companyInfoFetched: c?.info_fetched_at ?? null },
  };
}

// ---------- market overview ----------
export function latestTradingDate(): string | null {
  return get<{ d: string }>("SELECT MAX(date) d FROM quotes")?.d ?? null;
}

export function marketSummary() {
  const date = latestTradingDate();
  const q = all<{ symbol: string; name: string | null; sector: string | null; close: number; change_pct: number | null; change: number | null; volume: number | null; turnover: number | null; trades: number | null; high52: number | null; low52: number | null; prev_close: number | null }>(
    `SELECT q.*, c.name, c.sector FROM quotes q LEFT JOIN companies c ON c.symbol = q.symbol WHERE q.date = ?`, date,
  );
  const stocks = q.filter((r) => !/mutual fund|debenture|promoter/i.test(r.sector || ""));
  const adv = stocks.filter((r) => (r.change_pct ?? 0) > 0).length;
  const dec = stocks.filter((r) => (r.change_pct ?? 0) < 0).length;
  const unch = stocks.length - adv - dec;
  const totalTurnover = q.reduce((s, r) => s + (r.turnover ?? 0), 0);
  const totalVolume = q.reduce((s, r) => s + (r.volume ?? 0), 0);
  const totalTrades = q.reduce((s, r) => s + (r.trades ?? 0), 0);
  const top = (arr: typeof q, key: keyof (typeof q)[number], dir: 1 | -1, n = 10) => [...arr].filter((r) => r[key] != null).sort((a, b) => dir * (((b[key] as number) ?? 0) - ((a[key] as number) ?? 0))).slice(0, n);
  const pick = (r: (typeof q)[number]) => ({ symbol: r.symbol, name: r.name, sector: r.sector, close: r.close, changePct: r.change_pct, turnover: r.turnover, volume: r.volume });
  const bySector = new Map<string, { sector: string; n: number; adv: number; dec: number; turnover: number; avgChange: number }>();
  for (const r of stocks) {
    const k = r.sector || "Unclassified";
    const e = bySector.get(k) || { sector: k, n: 0, adv: 0, dec: 0, turnover: 0, avgChange: 0 };
    e.n++; e.turnover += r.turnover ?? 0; e.avgChange += r.change_pct ?? 0;
    if ((r.change_pct ?? 0) > 0) e.adv++; else if ((r.change_pct ?? 0) < 0) e.dec++;
    bySector.set(k, e);
  }
  const sectors = [...bySector.values()].map((e) => ({ ...e, avgChange: Math.round((e.avgChange / e.n) * 100) / 100 })).sort((a, b) => b.turnover - a.turnover);
  const highs52 = stocks.filter((r) => r.high52 && r.close >= r.high52 * 0.999).map(pick);
  const lows52 = stocks.filter((r) => r.low52 && r.close <= r.low52 * 1.001).map(pick);

  const idx = all<{ index_id: number; name: string; date: string; close: number; change: number | null; change_pct: number | null; turnover: number | null }>(
    `SELECT i.* FROM indices i JOIN (SELECT index_id, MAX(date) d FROM indices GROUP BY index_id) m ON m.index_id = i.index_id AND m.d = i.date ORDER BY i.index_id`,
  );
  // Market trend from NEPSE index moving averages.
  const nepse = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 ORDER BY date");
  let trend: { label: string; notes: string[] } | null = null;
  if (nepse.length > 200) {
    const c = nepse.map((r) => r.close);
    const s50 = sma(c, 50)[c.length - 1] as number, s200 = sma(c, 200)[c.length - 1] as number;
    const last = c[c.length - 1];
    const notes = [
      `NEPSE ${last.toFixed(2)} vs 50-day average ${s50.toFixed(2)} and 200-day average ${s200.toFixed(2)}.`,
      `20-session change: ${(((last - c[c.length - 21]) / c[c.length - 21]) * 100).toFixed(2)}%.`,
    ];
    trend = { label: last > s50 && s50 > s200 ? "Uptrend" : last < s50 && s50 < s200 ? "Downtrend" : "Sideways / transition", notes };
  }
  const breadth = adv + dec ? adv / (adv + dec) : null;
  const sentiment = breadth == null ? null : {
    breadthRatio: Math.round(breadth * 100) / 100,
    label: breadth > 0.65 ? "Broadly positive" : breadth > 0.5 ? "Mildly positive" : breadth > 0.35 ? "Mildly negative" : "Broadly negative",
    method: "Share of advancing stocks among all stocks that moved today (excludes mutual funds, debentures and promoter shares).",
  };
  return {
    date, counts: { traded: q.length, advancers: adv, decliners: dec, unchanged: unch },
    totals: { turnover: totalTurnover, volume: totalVolume, trades: totalTrades },
    gainers: top(stocks, "change_pct", 1).map(pick), losers: top(stocks, "change_pct", -1).map(pick),
    turnover: top(q, "turnover", 1).map(pick), volume: top(q, "volume", 1).map(pick),
    sectors, highs52: highs52.slice(0, 20), lows52: lows52.slice(0, 20), highs52Count: highs52.length, lows52Count: lows52.length,
    indices: idx, trend, sentiment,
    marketCap: null as number | null,
  };
}

// ---------- factors for ranking (cached per data date) ----------
let factorCache: { key: string; rows: StockFactors[] } | null = null;

export function allFactors(): StockFactors[] {
  const key = `${latestTradingDate()}|${get<{ n: number }>("SELECT COUNT(*) n FROM reports")?.n}|${get<{ n: number }>("SELECT COUNT(*) n FROM dividends")?.n}`;
  if (factorCache?.key === key) return factorCache.rows;
  const cos = all<{ symbol: string; name: string | null; sector: string | null }>(
    "SELECT c.symbol, c.name, c.sector FROM companies c JOIN quotes q ON q.symbol = c.symbol WHERE c.status = 'active'",
  ).filter((c) => !/mutual fund|debenture|promoter/i.test(c.sector || ""));
  const rows: StockFactors[] = [];
  for (const c of cos) {
    try {
      const b = bars(c.symbol, { limit: 400 }).bars;
      if (b.length < 30) continue;
      const snap = technicalSnapshot(b);
      const fa = fundamentalsFor(c.symbol);
      const sig = b.length >= 60 ? generateSetups(b, { symbol: c.symbol, fundamentalScore: fa?.score.overall ?? null }) : null;
      const bestBuy = sig?.setups.find((s) => s.side === "buy");
      const comp = (n: RegExp) => fa?.score.components.find((x) => n.test(x.name))?.score ?? null;
      const last20 = b.slice(-20);
      rows.push({
        symbol: c.symbol, name: c.name || c.symbol, sector: c.sector || "Unclassified", price: snap?.close ?? null, asOf: snap?.asOf ?? null,
        avgTurnover20: last20.reduce((s, x) => s + (x.amount ?? x.close * x.volume), 0) / last20.length,
        fundamentalScore: fa?.score.overall ?? null, profitabilityScore: comp(/Profitability/), valuationScore: comp(/Valuation/),
        healthScore: comp(/health|quality|strength/i), dividendScore: comp(/Dividend/), growthScore: comp(/Growth/),
        technicalScore: snap?.technicalScore ?? null,
        roe: fa?.byKey.roe ?? null, pe: fa?.byKey.pe ?? null, pb: fa?.byKey.pb ?? null, eps: fa?.byKey.eps ?? null,
        cashYield: fa?.byKey.cashYield ?? null, yearsPaid5: fa?.dividend.history.length ? fa.dividend.yearsPaidLast5 : null,
        profitGrowthYoY: fa?.growth.find((g) => g.label.startsWith("Net profit YoY"))?.value ?? null,
        return1m: snap?.return1m ?? null, return3m: snap?.return3m ?? null, return6m: snap?.return6m ?? null, return1y: snap?.return1y ?? null,
        rsi: snap?.rsi ?? null, adx: snap?.adx ?? null, trend: snap?.trend ?? null, atrPct: snap?.atrPct ?? null,
        volatility: annualisedVolatility(b.map((x) => x.close)),
        distFrom52wHighPct: snap ? Math.round(((snap.close - snap.high52) / snap.high52) * 1000) / 10 : null,
        setupQuality: bestBuy?.quality ?? null, setupType: bestBuy?.type ?? null,
        redFlags: fa?.redFlags.length ?? 0,
      });
    } catch (e) {
      console.warn(`[factors] ${c.symbol}: ${e instanceof Error ? e.message : e}`);
    }
  }
  factorCache = { key, rows };
  return rows;
}

let setupCache: { key: string; rows: ReturnType<typeof computeSetups> } | null = null;
export function allSetups(limit = 100) {
  const key = `${latestTradingDate()}|${get<{ n: number }>("SELECT COUNT(*) n FROM reports")?.n}`;
  if (setupCache?.key !== key) setupCache = { key, rows: computeSetups() };
  return setupCache.rows.slice(0, limit);
}

function computeSetups() {
  const cos = all<{ symbol: string }>("SELECT c.symbol FROM companies c JOIN quotes q ON q.symbol = c.symbol WHERE c.status = 'active' AND (c.sector IS NULL OR c.sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share'))");
  const f = new Map(allFactors().map((r) => [r.symbol, r]));
  const out = [];
  for (const { symbol } of cos) {
    const b = bars(symbol, { limit: 400 }).bars;
    if (b.length < 60) continue;
    const fr = f.get(symbol);
    if ((fr?.avgTurnover20 ?? 0) < 2_000_000) continue; // skip illiquid
    const r = generateSetups(b, { symbol, fees: fees(), fundamentalScore: fr?.fundamentalScore ?? null });
    for (const s of r.setups) out.push({ ...s, name: fr?.name, sector: fr?.sector, avgTurnover20: fr?.avgTurnover20 });
  }
  return out.sort((a, b) => b.quality - a.quality);
}
