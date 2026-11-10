// Trading Opportunities service: evaluates every listed equity with shared/opportunities.ts on the
// stored prices and statements, keeps a forward log of BUY/SELL signals with their outcomes, and a
// walk-forward track record. Heavy results are precomputed into the snapshot by the export script.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import { evaluate, longTermIdea, trackRecord, summarizeTrack, type FundamentalInput, type Opportunity, type LongTermIdea, type TrackTrade } from "../../shared/opportunities.ts";

export function fundamentalInput(symbol: string): FundamentalInput | null {
  const fa = M.fundamentalsFor(symbol);
  if (!fa) return null;
  const comp = (n: RegExp) => fa.score.components.find((x) => n.test(x.name))?.score ?? null;
  return {
    score: fa.score.overall ?? null, valuationScore: comp(/Valuation/), redFlags: fa.redFlags, strengths: fa.strengths,
    pe: fa.byKey.pe ?? null, pb: fa.byKey.pb ?? null, roe: fa.byKey.roe ?? null, cashYield: fa.byKey.cashYield ?? null,
    yearsPaid5: fa.dividend.history.length ? fa.dividend.yearsPaidLast5 : null, period: fa.latestPeriod ?? null,
  };
}

const priceKind = () => {
  const live = get<{ source: string | null; as_of: string | null; last_success_at: string | null }>("SELECT source, as_of, last_success_at FROM data_freshness WHERE dataset = 'prices_latest'");
  return live;
};

export function computeOpportunities(): { asOf: string | null; rows: Opportunity[]; longTerm: LongTermIdea[] } {
  const latest = M.latestTradingDate() ?? new Date().toISOString().slice(0, 10);
  const turnover = new Map(M.allFactors().map((f) => [f.symbol, f.avgTurnover20]));
  const cos = all<{ symbol: string; name: string | null; sector: string | null }>(
    "SELECT symbol, name, sector FROM companies WHERE status = 'active' AND (sector IS NULL OR sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share'))");
  const rows: Opportunity[] = [];
  const longTerm: LongTermIdea[] = [];
  const fees = M.fees();
  for (const c of cos) {
    try {
      const bars = M.bars(c.symbol, { limit: 420 }).bars;
      const fa = fundamentalInput(c.symbol);
      const o = evaluate({ symbol: c.symbol, name: c.name || c.symbol, sector: c.sector || "Unclassified", bars, fundamentals: fa, avgTurnover20: turnover.get(c.symbol) ?? null, latestMarketDate: latest, fees });
      rows.push(o);
      const lt = longTermIdea(o, fa);
      if (lt) longTerm.push(lt);
    } catch (e) { console.warn(`[opportunities] ${c.symbol}: ${e instanceof Error ? e.message : e}`); }
  }
  const order: Record<string, number> = { buy: 0, sell: 1, watch: 2, hold: 3, avoid: 4, insufficient: 5 };
  rows.sort((a, b) => order[a.bucket] - order[b.bucket] || b.confidence - a.confidence);
  longTerm.sort((a, b) => b.fundamentalScore - a.fundamentalScore);
  return { asOf: latest, rows, longTerm };
}

let cache: { key: string; data: ReturnType<typeof computeOpportunities> } | null = null;
export function opportunities() {
  const key = M.setupKeyPublic();
  if (cache?.key === key) return cache.data;
  const pre = M.persistedPublic<ReturnType<typeof computeOpportunities>>("opportunities", key);
  cache = { key, data: pre ?? computeOpportunities() };
  return cache.data;
}

export function computeTrack() {
  const turnover = M.allFactors().filter((f) => (f.avgTurnover20 ?? 0) >= 2_000_000);
  const trades: TrackTrade[] = [];
  const fees = M.fees();
  for (const f of turnover) {
    try { trades.push(...trackRecord(f.symbol, M.bars(f.symbol, { limit: 520 }).bars, fundamentalInput(f.symbol), { step: 5, lookback: 250, fees })); } catch { /* skip */ }
  }
  trades.sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = M.latestTradingDate();
  return { asOf: latest, method: "Walk-forward replay of the BUY rule over the last ~250 sessions on liquid stocks (turnover at least Rs. 20 lakh/day), checked every 5 sessions using only data available on that day. Entry at the next open if inside the entry zone; exit at stop-loss, target 1, or after 20 (swing) / 60 (positional) sessions. Returns are after broker commission, SEBON fee, DP charge and CGT on 100 shares.", summary: summarizeTrack(trades), trades: trades.slice(0, 300) };
}

let trackCache: ReturnType<typeof computeTrack> | null = null;
export function track() {
  // Historical replay: reuse the snapshot's copy even when today's live prices change.
  trackCache ??= M.persistedAny<ReturnType<typeof computeTrack>>("track") ?? computeTrack();
  return trackCache;
}

/** Each opportunity with its setup type's real past results, and confidence tempered by them. */
export function withTrack(rows: Opportunity[]) {
  const t = track();
  const by = new Map(t.summary.byType.map((x) => [x.type, x]));
  return rows.map((o) => {
    const h = o.setupType ? by.get(o.setupType) : undefined;
    if (!h || !h.trades || (o.action !== "BUY" && o.action !== "WATCH")) return { ...o, history: h ?? null };
    // Blend: setups whose type lost money historically lose confidence.
    const adj = h.trades >= 10 ? Math.round(((h.winRatePct ?? 50) - 50) / 2) + (h.avgNetPct != null && h.avgNetPct < 0 ? -5 : 5) : 0;
    let confidence = Math.max(5, Math.min(95, o.confidence + adj));
    // Evidence first: a setup type that lost money on average can't be "High" confidence.
    if (h.trades >= 10 && h.avgNetPct != null && h.avgNetPct < 0) confidence = Math.min(confidence, 70);
    return { ...o, history: h, confidence, confidenceLabel: (confidence >= 75 ? "High" : confidence >= 55 ? "Medium" : "Low") as Opportunity["confidenceLabel"] };
  });
}

/** Forward log: each day's BUY and SELL signals, judged later against actual prices. */
export function signalLog(limit = 200) {
  let rows: { date: string; symbol: string; action: string; setup: string | null; entry_low: number | null; entry_high: number | null; stop: number | null; t1: number | null; t2: number | null; price: number | null }[] = [];
  try { rows = all("SELECT * FROM signal_log ORDER BY date DESC, symbol LIMIT ?", limit); } catch { return { rows: [], summary: null }; }
  const judged = rows.map((r) => {
    const after = all<{ date: string; high: number; low: number; close: number }>("SELECT date, high, low, close FROM prices WHERE symbol = ? AND date > ? ORDER BY date LIMIT 60", r.symbol, r.date);
    let status = "Open", on: string | null = null;
    if (r.action === "BUY" && r.stop != null && r.t1 != null) {
      for (const b of after) { if (b.low <= r.stop) { status = "Stop hit"; on = b.date; break; } if (b.high >= r.t1) { status = r.t2 != null && after.some((x) => x.date >= b.date && x.high >= (r.t2 as number)) ? "Target 2 hit" : "Target 1 hit"; on = b.date; break; } }
      if (status === "Open" && after.length >= 40) status = "Expired";
    } else if (r.action === "SELL") {
      const c = after[Math.min(after.length - 1, 19)]?.close;
      if (after.length >= 20 && c != null && r.price != null) { status = c < r.price ? "Correct (fell)" : "Wrong (rose)"; on = after[19].date; }
    }
    const lastClose = after[after.length - 1]?.close ?? null;
    return { ...r, status, on, lastClose, changePct: lastClose != null && r.price ? Math.round(((lastClose - r.price) / r.price) * 1000) / 10 : null };
  });
  const closed = judged.filter((r) => r.action === "BUY" && r.status !== "Open");
  const hits = closed.filter((r) => r.status.startsWith("Target")).length;
  return { rows: judged, summary: { buySignals: judged.filter((r) => r.action === "BUY").length, closed: closed.length, targetHitPct: closed.length ? Math.round((hits / closed.length) * 1000) / 10 : null, sinceDate: judged[judged.length - 1]?.date ?? null } };
}

export { priceKind };
