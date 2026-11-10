// Market insights computed from stored data: the market home (indices, turnover vs the previous
// session, leaders, disclosures, sector heatmap, movers), the technical signal board and the
// quarterly results board. Heavy parts are precomputed into the snapshot by the export script.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import { computeAll } from "../../shared/indicators.ts";

const r2 = (x: number) => Math.round(x * 100) / 100;
const EQUITY = "sector IS NOT NULL AND sector NOT IN ('Mutual Fund','Corporate Debentures','Promoter Share')";

export function marketHome(period: "1D" | "1W" | "1M" | "1Y" = "1D") {
  const dates = all<{ date: string }>("SELECT DISTINCT date FROM prices ORDER BY date DESC LIMIT 2").map((r) => r.date);
  const [d0, d1] = dates;
  const idx = all<{ index_id: number; name: string; close: number; change: number | null; change_pct: number | null; date: string }>(
    "SELECT i.index_id, i.name, i.close, i.change, i.change_pct, i.date FROM indices i JOIN (SELECT index_id, MAX(date) d FROM indices GROUP BY index_id) m ON m.index_id = i.index_id AND m.d = i.date WHERE i.name IN ('NEPSE Index','Sensitive Index','Float Index','Sensitive Float Index') ORDER BY i.index_id");
  const turn = (d?: string) => (d ? get<{ amt: number; qty: number; n: number }>("SELECT SUM(amount) amt, SUM(volume) qty, COUNT(*) n FROM prices WHERE date = ? AND volume > 0", d) : undefined);
  const t0 = turn(d0), t1 = turn(d1);
  const q = all<{ symbol: string; name: string; sector: string; close: number; prev_close: number | null; change_pct: number | null; high: number | null; low: number | null; volume: number | null; turnover: number | null; high52: number | null; low52: number | null }>(
    `SELECT q.symbol, c.name, c.sector, q.close, q.prev_close, q.change_pct, q.high, q.low, q.volume, q.turnover, q.high52, q.low52 FROM quotes q JOIN companies c ON c.symbol = q.symbol WHERE c.${EQUITY} AND q.volume > 0`);
  const top = <T>(arr: T[], f: (x: T) => number) => [...arr].sort((a, b) => f(b) - f(a));
  const volatile = top(q.filter((x) => x.high && x.low && x.prev_close), (x) => ((x.high! - x.low!) / x.prev_close!) * 100)[0];
  const near52h = top(q.filter((x) => x.high52), (x) => x.close / x.high52!)[0];
  const near52l = top(q.filter((x) => x.low52), (x) => -x.close / x.low52!)[0];
  const adv = q.filter((x) => (x.change_pct ?? 0) > 0).length, dec = q.filter((x) => (x.change_pct ?? 0) < 0).length;
  // Disclosures: recent dividend/bonus declarations and upcoming AGMs.
  const dividends = all<{ symbol: string; fiscal_year: string; cash_pct: number | null; bonus_pct: number | null; announcement_date: string }>(
    "SELECT symbol, fiscal_year, cash_pct, bonus_pct, announcement_date FROM dividends WHERE announcement_date IS NOT NULL AND announcement_date >= date('now','-60 days') ORDER BY announcement_date DESC LIMIT 20");
  let agms: { symbol: string; title: string; date: string; url: string }[] = [];
  try {
    agms = all<{ symbol: string; title: string; published_date: string; url: string }>(
      `SELECT symbol, title, published_date, url FROM company_events WHERE kind = 'AGM / SGM' AND published_date >= date('now','-1 day') AND lower(title) NOT LIKE '%book clos%' AND lower(title) NOT LIKE '%notice%' ORDER BY published_date LIMIT 15`).map((r) => ({ symbol: r.symbol, title: r.title, date: r.published_date, url: r.url }));
  } catch { /* older snapshot */ }
  const pick = (x: (typeof q)[number]) => ({ symbol: x.symbol, name: x.name, sector: x.sector, close: x.close, changePct: x.change_pct, volume: x.volume, turnover: x.turnover });
  return {
    date: d0 ?? null, previousDate: d1 ?? null, indices: idx,
    turnover: { today: t0?.amt ?? 0, previous: t1?.amt ?? 0, shares: t0?.qty ?? 0, traded: t0?.n ?? 0, changePct: t0?.amt && t1?.amt ? r2(((t0.amt - t1.amt) / t1.amt) * 100) : null },
    breadth: { advancers: adv, decliners: dec, unchanged: q.length - adv - dec },
    leaders: {
      turnover: top(q, (x) => x.turnover ?? 0)[0] ? pick(top(q, (x) => x.turnover ?? 0)[0]) : null,
      volume: top(q, (x) => x.volume ?? 0)[0] ? pick(top(q, (x) => x.volume ?? 0)[0]) : null,
      volatile: volatile ? { ...pick(volatile), rangePct: r2(((volatile.high! - volatile.low!) / volatile.prev_close!) * 100) } : null,
      near52High: near52h ? { ...pick(near52h), pctFrom: r2(((near52h.close - near52h.high52!) / near52h.high52!) * 100) } : null,
      near52Low: near52l ? { ...pick(near52l), pctFrom: r2(((near52l.close - near52l.low52!) / near52l.low52!) * 100) } : null,
    },
    disclosures: { dividends, agms },
    heatmap: sectorHeatmap(period),
    movers: {
      gainers: top(q, (x) => x.change_pct ?? -99).slice(0, 50).map(pick), losers: top(q, (x) => -(x.change_pct ?? 99)).slice(0, 50).map(pick),
      volume: top(q, (x) => x.volume ?? 0).slice(0, 50).map(pick), turnover: top(q, (x) => x.turnover ?? 0).slice(0, 50).map(pick),
    },
  };
}

/** Sector performance over a period: average return of its stocks, ups/downs, and the best stock. */
export function sectorHeatmap(period: "1D" | "1W" | "1M" | "1Y") {
  const back = { "1D": 1, "1W": 5, "1M": 21, "1Y": 245 }[period];
  const rows = all<{ symbol: string; sector: string; ret: number | null; amount: number | null }>(`
    WITH d AS (SELECT DISTINCT date FROM prices ORDER BY date DESC LIMIT ${back + 1}),
    lim AS (SELECT MIN(date) d0, MAX(date) d1 FROM d)
    SELECT c.symbol, c.sector,
      ((SELECT close FROM prices p WHERE p.symbol = c.symbol AND p.date = (SELECT d1 FROM lim)) / (SELECT close FROM prices p WHERE p.symbol = c.symbol AND p.date <= (SELECT d0 FROM lim) ORDER BY date DESC LIMIT 1) - 1) * 100 AS ret,
      (SELECT amount FROM prices p WHERE p.symbol = c.symbol AND p.date = (SELECT d1 FROM lim)) amount
    FROM companies c WHERE c.status = 'active' AND c.${EQUITY}`);
  const by = new Map<string, { n: number; up: number; down: number; sum: number; best: { symbol: string; ret: number } | null; amount: number }>();
  for (const r of rows) {
    if (r.ret == null || !Number.isFinite(r.ret)) continue;
    const e = by.get(r.sector) ?? { n: 0, up: 0, down: 0, sum: 0, best: null, amount: 0 };
    e.n++; e.sum += r.ret; if (r.ret > 0) e.up++; else if (r.ret < 0) e.down++;
    if (!e.best || r.ret > e.best.ret) e.best = { symbol: r.symbol, ret: r2(r.ret) };
    e.amount += r.amount ?? 0;
    by.set(r.sector, e);
  }
  return [...by.entries()].map(([sector, e]) => ({ sector, stocks: e.n, changePct: r2(e.sum / e.n), up: e.up, down: e.down, best: e.best, turnover: e.amount })).sort((a, b) => b.stocks - a.stocks);
}

// ---------- technical signal board ----------
export interface SignalRow { symbol: string; name: string; sector: string; close: number; changePct: number | null; signals: { key: string; label: string; dir: 1 | -1 | 0 }[]; net: number }
export const SIGNAL_DEFS: { key: string; label: string; group: string; dir: 1 | -1 | 0 }[] = [
  { key: "oversold", label: "Oversold (RSI up to 30)", group: "Momentum", dir: 1 }, { key: "overbought", label: "Overbought (RSI at least 70)", group: "Momentum", dir: -1 },
  { key: "macd_above", label: "MACD above signal", group: "Momentum", dir: 1 }, { key: "macd_up", label: "MACD crossed up (15 sessions)", group: "Momentum", dir: 1 }, { key: "macd_down", label: "MACD crossed down (15 sessions)", group: "Momentum", dir: -1 },
  { key: "x_up_20", label: "Crossed above SMA 20", group: "Moving averages", dir: 1 }, { key: "x_dn_20", label: "Crossed below SMA 20", group: "Moving averages", dir: -1 },
  { key: "x_up_50", label: "Crossed above SMA 50", group: "Moving averages", dir: 1 }, { key: "x_dn_50", label: "Crossed below SMA 50", group: "Moving averages", dir: -1 },
  { key: "x_up_200", label: "Crossed above SMA 200", group: "Moving averages", dir: 1 }, { key: "x_dn_200", label: "Crossed below SMA 200", group: "Moving averages", dir: -1 },
  { key: "golden", label: "Golden cross (50 over 200)", group: "Moving averages", dir: 1 }, { key: "death", label: "Death cross (50 under 200)", group: "Moving averages", dir: -1 },
  { key: "above_all", label: "Above 20, 50 and 200 day", group: "Moving averages", dir: 1 }, { key: "below_all", label: "Below 20, 50 and 200 day", group: "Moving averages", dir: -1 },
  { key: "above_vwap", label: "Above 20-day VWAP", group: "Moving averages", dir: 1 },
  { key: "hi20", label: "Broke the 20-day high", group: "Breakout", dir: 1 }, { key: "hi50", label: "Broke the 50-day high", group: "Breakout", dir: 1 }, { key: "lo20", label: "Broke the 20-day low", group: "Breakout", dir: -1 },
  { key: "vol2x", label: "Volume 2x or more", group: "Volume & circuit", dir: 0 }, { key: "circuit_up", label: "Hit the +10% circuit", group: "Volume & circuit", dir: 1 }, { key: "circuit_dn", label: "Hit the −10% circuit", group: "Volume & circuit", dir: -1 },
];

export function computeSignalBoard() {
  const cos = all<{ symbol: string; name: string; sector: string }>(`SELECT c.symbol, c.name, c.sector FROM companies c JOIN quotes q ON q.symbol = c.symbol WHERE c.status = 'active' AND c.${EQUITY} AND q.volume > 0`);
  const rows: SignalRow[] = [];
  const breadth = { above: 0, between: 0, below: 0, counted: 0 };
  const label = new Map(SIGNAL_DEFS.map((d) => [d.key, d]));
  for (const c of cos) {
    const b = M.bars(c.symbol, { limit: 320 }).bars;
    if (b.length < 60) continue;
    const ind = computeAll(b);
    const n = b.length - 1, last = b[n], prev = b[n - 1];
    const s20 = ind.sma20, s50 = ind.sma50, s200 = ind.sma200;
    const crossed = (series: (number | null)[], dir: 1 | -1, lookback = 15) => { for (let i = n; i > n - lookback && i > 0; i--) { const a = series[i], p = series[i - 1]; if (a == null || p == null) continue; if (dir === 1 ? b[i - 1].close <= p && b[i].close > a : b[i - 1].close >= p && b[i].close < a) return true; } return false; };
    const lineCross = (fast: (number | null)[], slow: (number | null)[], dir: 1 | -1, lookback = 15) => { for (let i = n; i > n - lookback && i > 0; i--) { const f = fast[i], s = slow[i], fp = fast[i - 1], sp = slow[i - 1]; if (f == null || s == null || fp == null || sp == null) continue; if (dir === 1 ? fp <= sp && f > s : fp >= sp && f < s) return true; } return false; };
    const sig: string[] = [];
    const rsi = ind.rsi14[n];
    if (rsi != null && rsi <= 30) sig.push("oversold");
    if (rsi != null && rsi >= 70) sig.push("overbought");
    const mac = ind.macd.macd[n], msig = ind.macd.signal[n];
    if (mac != null && msig != null && mac > msig) sig.push("macd_above");
    if (lineCross(ind.macd.macd, ind.macd.signal, 1)) sig.push("macd_up");
    if (lineCross(ind.macd.macd, ind.macd.signal, -1)) sig.push("macd_down");
    if (crossed(s20, 1)) sig.push("x_up_20"); if (crossed(s20, -1)) sig.push("x_dn_20");
    if (crossed(s50, 1)) sig.push("x_up_50"); if (crossed(s50, -1)) sig.push("x_dn_50");
    if (crossed(s200, 1)) sig.push("x_up_200"); if (crossed(s200, -1)) sig.push("x_dn_200");
    if (lineCross(s50, s200, 1)) sig.push("golden"); if (lineCross(s50, s200, -1)) sig.push("death");
    if (s20[n] != null && s50[n] != null && s200[n] != null) {
      breadth.counted++;
      const above = last.close > s20[n]! && last.close > s50[n]! && last.close > s200[n]!, below = last.close < s20[n]! && last.close < s50[n]! && last.close < s200[n]!;
      if (above) { breadth.above++; sig.push("above_all"); } else if (below) { breadth.below++; sig.push("below_all"); } else breadth.between++;
    }
    const vw = ind.vwap.rolling[n];
    if (vw != null && last.close > vw) sig.push("above_vwap");
    const hi = (k: number) => Math.max(...b.slice(n - k, n).map((x) => x.high)), lo = (k: number) => Math.min(...b.slice(n - k, n).map((x) => x.low));
    if (last.close > hi(20)) sig.push("hi20"); if (last.close > hi(50)) sig.push("hi50"); if (last.close < lo(20)) sig.push("lo20");
    const avgVol = b.slice(n - 20, n).reduce((a, x) => a + x.volume, 0) / 20;
    if (avgVol > 0 && last.volume >= avgVol * 2) sig.push("vol2x");
    const chg = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
    if (chg >= 9.5) sig.push("circuit_up"); if (chg <= -9.5) sig.push("circuit_dn");
    const signals = sig.map((k) => ({ key: k, label: label.get(k)!.label, dir: label.get(k)!.dir }));
    rows.push({ symbol: c.symbol, name: c.name, sector: c.sector, close: last.close, changePct: r2(chg), signals, net: signals.reduce((a, x) => a + x.dir, 0) });
  }
  const counts = Object.fromEntries(SIGNAL_DEFS.map((d) => [d.key, rows.filter((r) => r.signals.some((s) => s.key === d.key)).length]));
  return { asOf: M.latestTradingDate(), defs: SIGNAL_DEFS, counts, breadth, rows: rows.sort((a, b) => b.net - a.net || b.signals.length - a.signals.length) };
}

let boardCache: { key: string; data: ReturnType<typeof computeSignalBoard> } | null = null;
export function signalBoard() {
  const key = M.setupKeyPublic();
  if (boardCache?.key === key) return boardCache.data;
  boardCache = { key, data: M.persistedPublic<ReturnType<typeof computeSignalBoard>>("signal_board", key) ?? computeSignalBoard() };
  return boardCache.data;
}

// ---------- quarterly results board ----------
const PROFIT = ["Net Profit", "Profit for the period", "Net Profit/(Loss) for The Year", "Net Profit for the period", "Net Profit for the Year", "Net Profit/(Loss) for the period"];
const TOPLINE = ["Total operating income", "Operating Income", "Net Earned Premiums", "Income from Sales of Electricity", "Revenue from Operations", "Revenue from Operation", "Revenue From Operation", "Total Revenue", "Income from Room Sales, Banquets, Restaurants & Others"];
function item(reportId: number, labels: string[]) {
  for (const l of labels) { const r = get<{ value: number | null }>("SELECT value FROM report_items WHERE report_id = ? AND label = ? AND statement <> 'metrics'", reportId, l) ?? get<{ value: number | null }>("SELECT value FROM report_items WHERE report_id = ? AND label = ?", reportId, l); if (r?.value != null) return { label: l, value: r.value }; }
  return null;
}
const QWORD = ["", "1st", "2nd", "3rd", "4th"];
/** Profit stated in a ShareSansar result headline ("net profit of Rs 551.15 million ... 1st quarter ... fiscal year 2082/83"), in Rs. '000. */
export function headlineProfit(title: string) {
  const m = title.match(/net (profit|loss) of Rs\.?\s*([\d.,]+)\s*(thousand|lakh|million|crore|billion|arba)?/i);
  if (!m) return null;
  const v = Number(m[2].replace(/,/g, ""));
  const mult: Record<string, number> = { thousand: 1, lakh: 100, million: 1000, crore: 10000, billion: 1_000_000, arba: 1_000_000 };
  const val = v * (mult[(m[3] ?? "thousand").toLowerCase()] ?? 1);
  return m[1].toLowerCase() === "loss" ? -val : val;
}
function headlineFor(symbol: string, q: number, fyShort: string) {
  const rows = all<{ title: string }>("SELECT title FROM announcements WHERE symbol = ? AND lower(title) LIKE ? AND title LIKE ?", symbol, `%${QWORD[q]} quarter%`, `%${fyShort}%`);
  for (const r of rows) { const v = headlineProfit(r.title); if (v != null) return v; }
  return null;
}

export function resultsBoard() {
  const latestQ = get<{ fy: string; q: number }>("SELECT fiscal_year fy, quarter q FROM reports ORDER BY fiscal_year DESC, quarter DESC LIMIT 1");
  if (!latestQ) return { quarter: null, rows: [], counts: null };
  const rep = all<{ id: number; symbol: string; period: string; fiscal_year: string; quarter: number; fetched_at: string }>("SELECT id, symbol, period, fiscal_year, quarter, fetched_at FROM reports WHERE fiscal_year = ? AND quarter = ?", latestQ.fy, latestQ.q);
  const prevQ = latestQ.q > 1 ? { fy: latestQ.fy, q: latestQ.q - 1 } : { fy: `${Number(latestQ.fy.slice(0, 4)) - 1}/${Number(latestQ.fy.slice(5)) - 1}`, q: 4 };
  const lastYear = { fy: `${Number(latestQ.fy.slice(0, 4)) - 1}/${Number(latestQ.fy.slice(5)) - 1}`, q: latestQ.q };
  const rows = rep.map((r) => {
    const c = get<{ name: string; sector: string }>("SELECT name, sector FROM companies WHERE symbol = ?", r.symbol);
    const p = item(r.id, PROFIT), t = item(r.id, TOPLINE);
    const other = (fy: string, q: number) => { const o = get<{ id: number }>("SELECT id FROM reports WHERE symbol = ? AND fiscal_year = ? AND quarter = ?", r.symbol, fy, q); return o ? item(o.id, PROFIT)?.value ?? null : null; };
    // Nepali quarterly figures are cumulative for the fiscal year (Q2 = 6 months), so the previous quarter is comparable only within the same year.
    // Last year's same quarter: stored statements, else the official result headline of that quarter.
    const ly = other(lastYear.fy, lastYear.q) ?? headlineFor(r.symbol, lastYear.q, `${lastYear.fy.slice(0, 4)}/${lastYear.fy.slice(-2)}`);
    const pq = other(prevQ.fy, prevQ.q);
    const ann = get<{ published_date: string; url: string }>("SELECT published_date, url FROM announcements WHERE symbol = ? AND category = 'Quarterly report' ORDER BY published_date DESC LIMIT 1", r.symbol);
    return { symbol: r.symbol, name: c?.name ?? r.symbol, sector: c?.sector ?? "", period: r.period, profit: p?.value ?? null, topLine: t?.value ?? null, topLineLabel: t?.label ?? null,
      lastYearProfit: ly, yoyPct: ly != null && p?.value != null && ly !== 0 ? r2(((p.value - ly) / Math.abs(ly)) * 100) : null, previousQuarterProfit: pq,
      published: ann?.published_date ?? r.fetched_at.slice(0, 10), url: ann?.url ?? null };
  }).filter((r) => r.profit != null);
  const withYoy = rows.filter((r) => r.yoyPct != null);
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM companies WHERE status = 'active' AND ${EQUITY}`)?.n ?? 0;
  return {
    quarter: `Q${latestQ.q} ${latestQ.fy}`, reported: rows.length, total, unit: "Rs. '000 as published",
    counts: { up: withYoy.filter((r) => r.yoyPct! > 0).length, down: withYoy.filter((r) => r.yoyPct! < 0).length, noCompare: rows.length - withYoy.length },
    highest: [...rows].sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))[0] ?? null,
    biggestRise: [...withYoy].sort((a, b) => b.yoyPct! - a.yoyPct!)[0] ?? null, biggestFall: [...withYoy].sort((a, b) => a.yoyPct! - b.yoyPct!)[0] ?? null,
    rows: rows.sort((a, b) => (a.published < b.published ? 1 : -1)),
    note: withYoy.length ? "" : "Year-on-year comparisons appear as each company's same quarter of last year is stored; history builds up from the daily refresh.",
  };
}

// ---------- floorsheet ----------
export function floorsheet(date?: string) {
  try {
    const d = date ?? get<{ d: string }>("SELECT MAX(date) d FROM floorsheet_day")?.d;
    if (!d) return null;
    const dates = all<{ date: string }>("SELECT DISTINCT date FROM floorsheet_day ORDER BY date DESC").map((r) => r.date);
    const rows = all<Record<string, unknown>>("SELECT f.*, c.name, c.sector FROM floorsheet_day f LEFT JOIN companies c ON c.symbol = f.symbol WHERE f.date = ? ORDER BY f.amount DESC", d);
    const tot = get<{ trades: number; qty: number; amount: number }>("SELECT SUM(trades) trades, SUM(qty) qty, SUM(amount) amount FROM floorsheet_day WHERE date = ?", d);
    const brokers = all<{ broker: number; buy: number; sell: number; net: number; stocks: number }>("SELECT broker, SUM(buy_amt) buy, SUM(sell_amt) sell, SUM(buy_amt) - SUM(sell_amt) net, COUNT(DISTINCT symbol) stocks FROM floorsheet_broker WHERE date = ? GROUP BY broker ORDER BY buy + sell DESC", d);
    return { date: d, dates, totals: tot, rows, brokers };
  } catch { return null; }
}

/** Broker activity in one stock over the stored sessions: who bought and sold the most. */
export function brokerActivity(symbol: string, days = 15) {
  try {
    const dates = all<{ date: string }>("SELECT DISTINCT date FROM floorsheet_day WHERE symbol = ? ORDER BY date DESC LIMIT ?", symbol, days).map((r) => r.date);
    if (!dates.length) return null;
    const rows = all<{ broker: number; buy_qty: number; sell_qty: number; buy_amt: number; sell_amt: number }>(`SELECT broker, SUM(buy_qty) buy_qty, SUM(sell_qty) sell_qty, SUM(buy_amt) buy_amt, SUM(sell_amt) sell_amt FROM floorsheet_broker WHERE symbol = ? AND date >= ? GROUP BY broker`, symbol, dates[dates.length - 1]);
    const net = rows.map((r) => ({ ...r, netQty: r.buy_qty - r.sell_qty, buyWacc: r.buy_qty ? r2(r.buy_amt / r.buy_qty) : null, sellWacc: r.sell_qty ? r2(r.sell_amt / r.sell_qty) : null }));
    const days0 = all("SELECT date, trades, qty, amount, wacc, buyers, sellers FROM floorsheet_day WHERE symbol = ? ORDER BY date DESC LIMIT ?", symbol, days);
    return { from: dates[dates.length - 1], to: dates[0], sessions: dates.length, topBuyers: [...net].sort((a, b) => b.netQty - a.netQty).slice(0, 8), topSellers: [...net].sort((a, b) => a.netQty - b.netQty).slice(0, 8), days: days0,
      note: "Brokers are identified by their NEPSE broker number. Net buying by a broker shows its clients' combined activity, not one investor; treat it as context, not a signal." };
  } catch { return null; }
}
