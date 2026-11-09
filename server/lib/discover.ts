// Market Mood (a NEPSE fear & greed gauge), ready-made stock baskets and the stock scorecard.
// Everything is computed from stored daily prices, the NEPSE index and the per-stock factor scores.
import { all } from "../db.ts";
import * as M from "./market.ts";
import { moodScore, BASKETS, scorecard, expectedRange, type MoodInputs } from "../../shared/discover.ts";

const EQ = "c.sector IS NOT NULL AND c.sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share') AND c.status = 'active'";
let moodCache: { key: string; v: ReturnType<typeof compute> } | null = null;

function compute() {
  const last = M.latestTradingDate();
  if (!last) return null;
  const daily = all<{ date: string; adv: number; dec: number; ab50: number; c50: number; hi: number; lo: number; c250: number }>(`
    WITH p AS (
      SELECT p.symbol, p.date, p.close, p.high, p.low,
        LAG(p.close) OVER w AS prev,
        AVG(p.close) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS 49 PRECEDING) AS a50,
        COUNT(*) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS 49 PRECEDING) AS n50,
        MAX(p.high) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS 249 PRECEDING) AS h250,
        MIN(p.low) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS 249 PRECEDING) AS l250,
        COUNT(*) OVER (PARTITION BY p.symbol ORDER BY p.date ROWS 249 PRECEDING) AS n250
      FROM prices p JOIN companies c ON c.symbol = p.symbol
      WHERE p.date >= date(?, '-620 days') AND ${EQ} AND p.close > 0
      WINDOW w AS (PARTITION BY p.symbol ORDER BY p.date))
    SELECT date, SUM(close > prev) adv, SUM(close < prev) dec, SUM(n50 = 50 AND close > a50) ab50, SUM(n50 = 50) c50,
      SUM(n250 = 250 AND high >= h250) hi, SUM(n250 = 250 AND low <= l250) lo, SUM(n250 = 250) c250
    FROM p WHERE date >= date(?, '-200 days') GROUP BY date ORDER BY date`, last, last);
  const idx = all<{ date: string; close: number; turnover: number | null }>("SELECT date, close, turnover FROM indices WHERE index_id = 12 AND close > 0 AND date >= date(?, '-400 days') ORDER BY date", last);
  const ix = new Map(idx.map((r, i) => [r.date, i]));
  const hist: { date: string; score: number; parts: ReturnType<typeof moodScore>["parts"] }[] = [];
  for (let k = 0; k < daily.length; k++) {
    const d = daily[k], i = ix.get(d.date);
    if (i == null || i < 125 || k < 9) continue;
    const win = daily.slice(k - 9, k + 1);
    const adv = win.reduce((s, x) => s + x.adv, 0), dec = win.reduce((s, x) => s + x.dec, 0);
    const closes = idx.slice(0, i + 1).map((r) => r.close);
    const ma125 = closes.slice(-125).reduce((a, b) => a + b, 0) / 125;
    const tv = idx.slice(Math.max(0, i - 59), i + 1).map((r) => r.turnover ?? 0).filter((x) => x > 0);
    const tv5 = idx.slice(Math.max(0, i - 4), i + 1).map((r) => r.turnover ?? 0).filter((x) => x > 0);
    let g = 0, l = 0; for (let j = closes.length - 14; j < closes.length; j++) { const ch = closes[j] - closes[j - 1]; if (ch > 0) g += ch; else l -= ch; }
    const inp: MoodInputs = {
      advancePct: adv + dec ? (adv / (adv + dec)) * 100 : null,
      above50Pct: d.c50 ? (d.ab50 / d.c50) * 100 : null,
      highsPct: d.hi + d.lo ? (d.hi / (d.hi + d.lo)) * 100 : 50,
      momentumPct: ((closes[closes.length - 1] / ma125) - 1) * 100,
      turnoverRatio: tv.length >= 20 && tv5.length ? (tv5.reduce((a, b) => a + b, 0) / tv5.length) / (tv.reduce((a, b) => a + b, 0) / tv.length) : null,
      rsi: l === 0 ? 100 : 100 - 100 / (1 + g / l),
    };
    const m = moodScore(inp);
    hist.push({ date: d.date, score: m.score, parts: m.parts });
  }
  const now = hist[hist.length - 1];
  if (!now) return null;
  const ago = (n: number) => hist[Math.max(0, hist.length - 1 - n)]?.score ?? null;
  return { asOf: now.date, score: now.score, parts: now.parts, weekAgo: ago(5), monthAgo: ago(21), history: hist.map((h) => [h.date, h.score] as [string, number]) };
}

export function marketMood() {
  const key = `${M.latestTradingDate()}`;
  if (!moodCache || moodCache.key !== key) moodCache = { key, v: compute() };
  return moodCache.v;
}

/** Each basket's members today and how an equal-weight basket of them did (price only). */
export function baskets() {
  const f = M.allFactors();
  const nepse = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND close > 0 ORDER BY date DESC LIMIT 260");
  const nRet = (n: number) => (nepse.length > n ? Math.round(((nepse[0].close / nepse[n].close) - 1) * 10000) / 100 : null);
  const ret = (sym: string, n: number) => { const b = M.bars(sym, { limit: n + 1 }).bars; return b.length > n ? (b[b.length - 1].close / b[0].close - 1) * 100 : null; };
  const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; };
  return {
    asOf: M.latestTradingDate(), nepse: { m3: nRet(63), y1: nRet(250) },
    baskets: BASKETS.map((b) => {
      const mem = b.pick(f);
      return { key: b.key, name: b.name, idea: b.idea, who: b.who, risk: b.risk, m3: avg(mem.map((m) => ret(m.symbol, 63))), y1: avg(mem.map((m) => ret(m.symbol, 250))),
        members: mem.map((m) => ({ symbol: m.symbol, name: m.name, sector: m.sector, price: m.price, pe: m.pe, cashYield: m.cashYield, fundamentalScore: m.fundamentalScore, technicalScore: m.technicalScore, return1y: m.return1y })) };
    }),
  };
}

export function stockCard(symbol: string) {
  const f = M.allFactors().find((x) => x.symbol === symbol);
  const b = M.bars(symbol, { limit: 80 }).bars;
  const price = b[b.length - 1]?.close ?? null;
  return { symbol, scorecard: f ? scorecard(f) : null, range: price != null ? expectedRange(price, b.map((x) => x.close)) : null, price };
}

import { RANK_STRATEGIES, rankStocks, type RankedRow } from "../../shared/ranking.ts";
/** Best stocks to invest in (fundamentals, "Long-term investment" ranking) and to trade (technicals, "Swing trading"
 *  ranking), overall and by sector, plus the ones strong on both. Same scores as Stock Analysis → Rankings. */
export function picks() {
  const all = M.allFactors().filter((f) => f.price != null);
  const inv = RANK_STRATEGIES.find((s) => s.key === "longterm")!, trd = RANK_STRATEGIES.find((s) => s.key === "swing")!, mom = RANK_STRATEGIES.find((s) => s.key === "momentum")!;
  const slim = (r: RankedRow) => ({ rank: r.rank, symbol: r.symbol, name: r.name, sector: r.sector, score: Math.round(r.score), price: r.factors.price, liquid: (r.factors.avgTurnover20 ?? 0) >= 1_000_000,
    why: r.contributions.filter((c) => c.raw != null).sort((a, b) => b.points - a.points).slice(0, 3).map((c) => c.label),
    pe: r.factors.pe, roe: r.factors.roe, cashYield: r.factors.cashYield, fundamental: r.factors.fundamentalScore, technical: r.factors.technicalScore, rsi: r.factors.rsi, trend: r.factors.trend, setup: r.factors.setupType, return3m: r.factors.return3m, return1y: r.factors.return1y });
  const invest = rankStocks(all, inv, undefined, 400).ranked.map(slim);
  const tradeSw = rankStocks(all, trd, undefined, 400).ranked.map(slim);
  const trade = tradeSw.length >= 10 ? tradeSw : rankStocks(all, mom, undefined, 400).ranked.map(slim);
  const iTop = new Set(invest.slice(0, Math.ceil(invest.length * 0.3)).map((x) => x.symbol)), tTop = new Set(trade.slice(0, Math.ceil(trade.length * 0.3)).map((x) => x.symbol));
  const both = invest.filter((x) => tTop.has(x.symbol)).map((x) => ({ ...x, tradeScore: trade.find((t) => t.symbol === x.symbol)?.score ?? null })).slice(0, 15);
  const sectors = [...new Set(all.map((f) => f.sector))].filter((s) => !/Promoter|Debenture/i.test(s)).sort();
  const bySector = sectors.map((s) => ({ sector: s, invest: invest.filter((x) => x.sector === s).slice(0, 3), trade: trade.filter((x) => x.sector === s).slice(0, 3) })).filter((x) => x.invest.length || x.trade.length);
  return { asOf: M.latestTradingDate(), investHow: `${inv.name}: ${inv.description}`, tradeHow: `${(tradeSw.length >= 10 ? trd : mom).name}: ${(tradeSw.length >= 10 ? trd : mom).description}`, invest: invest.slice(0, 25), trade: trade.slice(0, 25), both, bySector, inBoth: [...iTop].filter((s) => tTop.has(s)).length };
}
