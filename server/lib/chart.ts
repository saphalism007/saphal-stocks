// Chart terminal service: the per-stock analyst panel and the market-wide pattern scanner.
// The scanner is precomputed into the snapshot by the export script.
import { all } from "../db.ts";
import * as M from "./market.ts";
import * as TR from "./trading.ts";
import { evaluate, trackRecord, summarizeTrack } from "../../shared/opportunities.ts";
import { analyzeChart, type ChartAnalysis, type FundSummary, type TrackSummary, type PastSignal } from "../../shared/analyst.ts";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

function fundSummary(symbol: string, sector: string): FundSummary | null {
  const fa = M.fundamentalsFor(symbol);
  if (!fa) return null;
  const k = fa.byKey;
  const sectorPe = median(M.allFactors().filter((f) => f.sector === sector && f.pe != null && f.pe > 0 && f.pe < 200).map((f) => f.pe as number));
  return {
    score: fa.score.overall ?? null, period: fa.latestPeriod, sectorGroup: fa.sectorGroup,
    eps: k.eps ?? null, pe: k.pe ?? null, pb: k.pb ?? null, bvps: k.bvps ?? null, roe: k.roe ?? null, de: k.de ?? null, graham: k.graham ?? null,
    profitGrowth: fa.growth.find((g) => /Net profit YoY/i.test(g.label))?.value ?? null, revenueGrowth: fa.growth.find((g) => /Revenue/i.test(g.label))?.value ?? null,
    cashYield: fa.dividend.cashYieldPct, dividendYears5: fa.dividend.history.length ? fa.dividend.yearsPaidLast5 : null, sectorPe,
    redFlags: fa.redFlags, strengths: fa.strengths,
  };
}

function provisional(lastDate: string | undefined) {
  const npt = new Date(Date.now() + 345 * 60_000), mins = npt.getUTCHours() * 60 + npt.getUTCMinutes();
  return lastDate === npt.toISOString().slice(0, 10) && mins < 15 * 60 + 45;
}

export function analysisFor(symbol: string, opts: { history?: boolean } = {}): ChartAnalysis | null {
  const c = M.company(symbol) as { name?: string; sector?: string } | undefined;
  if (!c) return null;
  const sector = c.sector || "Unclassified";
  const bars = M.bars(symbol, { limit: 600 }).bars;
  const f = M.allFactors().find((x) => x.symbol === symbol);
  const fa = TR.fundamentalInput(symbol);
  const opp = TR.withTrack([evaluate({ symbol, name: c.name || symbol, sector, bars: bars.slice(-420), fundamentals: fa, avgTurnover20: f?.avgTurnover20 ?? null, latestMarketDate: M.latestTradingDate() ?? "", fees: M.fees() })])[0];
  let stockTrack: TrackSummary | null = null;
  let signals: PastSignal[] | undefined;
  if (opts.history && bars.length >= 200) {
    const trades = trackRecord(symbol, bars, fa, { step: 2, lookback: 580, fees: M.fees() });
    const s = summarizeTrack(trades);
    signals = trades.map((t) => ({ date: t.date, entryDate: bars[bars.findIndex((b) => b.date === t.date) + 1]?.date ?? t.date, entry: t.entry, stop: t.stop, t1: t.t1, exitDate: t.exitDate, exit: t.exit, outcome: t.outcome, netPct: t.netPct }));
    stockTrack = { trades: s.trades, winRatePct: s.winRatePct, avgNetPct: s.avgNetPct, targetHitPct: s.targetHitPct, stopHitPct: s.stopHitPct, recent: trades.slice(-6).reverse().map((t) => ({ date: t.date, type: t.type, outcome: t.outcome, netPct: t.netPct })) };
  }
  const a = analyzeChart({ symbol, name: c.name || symbol, sector, bars, opp, fund: fundSummary(symbol, sector), fees: M.fees(), stockTrack, avgTurnover20: f?.avgTurnover20 ?? null, provisional: provisional(bars[bars.length - 1]?.date) });
  if (signals) a.signals = signals;
  return a;
}

export interface ScanRow { symbol: string; name: string; sector: string; close: number | null; changePct: number | null; verdict: string; confidence: number; tags: string[]; notes: Record<string, string>; rsi: number | null; volumeRatio: number | null }

export function computeScanner(): { asOf: string | null; rows: ScanRow[] } {
  const liquid = new Set(M.allFactors().filter((f) => (f.avgTurnover20 ?? 0) >= 1_000_000).map((f) => f.symbol));
  const cos = all<{ symbol: string }>("SELECT symbol FROM companies WHERE status = 'active' AND (sector IS NULL OR sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share'))");
  const rows: ScanRow[] = [];
  for (const { symbol } of cos) {
    if (!liquid.has(symbol)) continue;
    try {
      const a = analysisFor(symbol);
      if (!a || !a.tags.length) continue;
      rows.push({ symbol, name: a.name, sector: a.sector, close: a.price, changePct: a.changePct, verdict: a.verdict, confidence: a.confidence, tags: a.tags, notes: a.tagNotes, rsi: a.indicators.rsi ?? null, volumeRatio: a.indicators.volumeRatio ?? null });
    } catch (e) { console.warn(`[scanner] ${symbol}: ${e instanceof Error ? e.message : e}`); }
  }
  return { asOf: M.latestTradingDate(), rows };
}

let cache: { key: string; data: ReturnType<typeof computeScanner> } | null = null;
export function scanner() {
  const key = M.setupKeyPublic();
  if (cache?.key === key) return cache.data;
  cache = { key, data: M.persistedPublic<ReturnType<typeof computeScanner>>("scanner", key) ?? computeScanner() };
  return cache.data;
}
