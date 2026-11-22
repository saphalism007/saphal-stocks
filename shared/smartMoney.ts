// Smart money and manipulation check for one stock. NEPSE is a thin market where a few large traders and brokers
// can move prices, so before any recommendation this reads two things:
//  1. Price and volume (always available): the Wyckoff-style phase (accumulation, markup, distribution, markdown),
//     money flow (Chaikin money flow, on-balance volume), and the classic operator footprints: sharp run-ups on
//     unusual volume, repeated upper-limit days, heavy volume without price movement, dumps after spikes, small or
//     thinly traded companies that are easy to move.
//  2. The floorsheet (broker by broker, last sessions stored): whether net buying is concentrated in a few brokers
//     while selling is spread across many (accumulation by big players), the reverse (distribution to the public),
//     brokers trading with themselves (crossing / circular trades) and brokers buying and selling large amounts at once.
// Rule-based and transparent. It cannot see who the end clients are and never claims to; it reports footprints.
import type { Bar } from "./types.ts";

export interface FloorDay { date: string; qty: number; amount: number; trades: number; buyers: number | null; sellers: number | null; crossQty: number | null }
export interface BrokerRow { date: string; broker: number; buyQty: number; sellQty: number }
export interface SmartMoneyInput { bars: Bar[]; listedShares: number | null; floor: FloorDay[]; brokers: BrokerRow[]; favourite?: { rank: number; of: number; side: "buy" | "sell" } | null }

export type Phase = "Accumulation" | "Markup" | "Distribution" | "Markdown" | "Sideways" | "Unclear";
export interface BrokerFlow { broker: number; buy: number; sell: number; net: number; netDays: number; days: number }
export interface SmartMoney {
  phase: Phase; phaseWhy: string;
  risk: "High" | "Medium" | "Low"; riskWhy: string[];
  brokerRead: "Accumulation" | "Distribution" | "Balanced" | "Not enough data";
  sessions: number;
  metrics: { cmf20: number | null; obvTrend: number | null; volRatio: number | null; ret10: number | null; ret20: number | null; ret120: number | null; posInRange: number | null; upLimitDays10: number; marketCapCr: number | null; avgTurnoverLakh: number | null;
    top3NetBuyPct: number | null; top3NetSellPct: number | null; top5BuyPct: number | null; crossPct: number | null };
  topBuyers: BrokerFlow[]; topSellers: BrokerFlow[];
  verdict: "positive" | "neutral" | "negative" | "unknown"; score: number | null;
  summary: string; reasons: string[];
  blocksBuy: string | null; // a reason strong enough to stop a buy
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const avg = (a: number[]) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);

export function smartMoney(inp: SmartMoneyInput): SmartMoney {
  const b = inp.bars, n = b.length;
  const reasons: string[] = [], riskWhy: string[] = [];
  const m: SmartMoney["metrics"] = { cmf20: null, obvTrend: null, volRatio: null, ret10: null, ret20: null, ret120: null, posInRange: null, upLimitDays10: 0, marketCapCr: null, avgTurnoverLakh: null, top3NetBuyPct: null, top3NetSellPct: null, top5BuyPct: null, crossPct: null };
  let phase: Phase = "Unclear", phaseWhy = "Not enough price history.";
  let riskPts = 0;

  if (n >= 60) {
    const c = b[n - 1].close;
    const last = (k: number) => b.slice(Math.max(0, n - k));
    // Chaikin money flow (20): where closes sit in each day's range, weighted by volume.
    const w20 = last(20);
    const mfv = w20.reduce((t, x) => t + (x.high > x.low ? (((x.close - x.low) - (x.high - x.close)) / (x.high - x.low)) * x.volume : 0), 0);
    const v20 = w20.reduce((t, x) => t + x.volume, 0);
    m.cmf20 = v20 ? mfv / v20 : null;
    // On-balance volume over 20 sessions, scaled by the volume traded in them (-1 to +1).
    let obv = 0;
    for (let i = n - 20; i < n; i++) obv += b[i].close > b[i - 1].close ? b[i].volume : b[i].close < b[i - 1].close ? -b[i].volume : 0;
    m.obvTrend = v20 ? obv / v20 : null;
    const vol5 = avg(last(5).map((x) => x.volume)), vol60 = avg(b.slice(Math.max(0, n - 65), n - 5).map((x) => x.volume));
    m.volRatio = vol60 ? vol5 / vol60 : null;
    m.ret10 = n > 10 ? pct(c, b[n - 11].close) : null;
    m.ret20 = n > 20 ? pct(c, b[n - 21].close) : null;
    m.ret120 = n > 120 ? pct(c, b[n - 121].close) : null;
    const ret5 = pct(c, b[n - 6].close);
    const w120 = last(120), hi = Math.max(...w120.map((x) => x.high)), lo = Math.min(...w120.map((x) => x.low));
    m.posInRange = hi > lo ? (c - lo) / (hi - lo) : null;
    const range20 = (Math.max(...w20.map((x) => x.high)) - Math.min(...w20.map((x) => x.low))) / c;
    for (let i = n - 10; i < n; i++) if (b[i].close >= b[i - 1].close * 1.095) m.upLimitDays10++;
    let upV = 0, dnV = 0;
    for (let i = n - 20; i < n; i++) { if (b[i].close > b[i - 1].close) upV += b[i].volume; else if (b[i].close < b[i - 1].close) dnV += b[i].volume; }
    const sma = (k: number) => (n >= k ? avg(b.slice(n - k).map((x) => x.close)) : null);
    const s50 = sma(50), s200 = sma(200);
    const turn = avg(w20.map((x) => x.amount ?? x.close * x.volume));
    m.avgTurnoverLakh = r1(turn / 1e5);
    if (inp.listedShares) m.marketCapCr = Math.round((inp.listedShares * c) / 1e7);
    const cmf = m.cmf20 ?? 0, ot = m.obvTrend ?? 0, pos = m.posInRange ?? 0.5;
    const flowIn = cmf > 0.05 || ot > 0.15 || upV > dnV * 1.3, flowOut = cmf < -0.05 || ot < -0.15 || dnV > upV * 1.3;

    // Phase, in order of what matters most to a buyer.
    if ((m.ret120 ?? 0) >= 30 && pos >= 0.7 && flowOut) { phase = "Distribution"; phaseWhy = `Up ${r1(m.ret120 ?? 0)}% in 6 months and near the top of its range, but selling pressure dominates (money flow ${r1(cmf * 100) / 100}, more volume on down days). Large holders may be selling into strength.`; }
    else if (pos <= 0.4 && range20 <= 0.16 && flowIn && (m.ret20 ?? 0) > -6) { phase = "Accumulation"; phaseWhy = `Moving sideways in the lower part of its 6-month range (${Math.round(range20 * 100)}% band) while buying volume dominates (money flow ${r1(cmf * 100) / 100}). This is how quiet buying by large players usually looks.`; }
    else if (s50 != null && c > s50 && (s200 == null || s50 > s200) && (m.ret20 ?? 0) > 0 && !flowOut) { phase = "Markup"; phaseWhy = "Rising above its 50- and 200-day averages with supportive volume: the up phase."; }
    else if (s50 != null && c < s50 && (s200 == null || s50 < s200) && (m.ret20 ?? 0) < 0) { phase = "Markdown"; phaseWhy = "Falling below its 50- and 200-day averages: the down phase. Large buyers are not yet visible."; }
    else { phase = "Sideways"; phaseWhy = "No clear accumulation or distribution footprint in price and volume."; }

    // Operator footprints.
    if (((m.ret10 ?? 0) >= 25 || (m.ret20 ?? 0) >= 40) && (m.volRatio ?? 0) >= 2.5) { riskPts += 2; riskWhy.push(`Sharp run-up (${r1(m.ret10 ?? 0)}% in 10 sessions, ${r1(m.ret20 ?? 0)}% in 20) on ${r1(m.volRatio ?? 0)}x normal volume: a common pattern in operator-driven moves. Late buyers often get caught when it reverses.`); }
    else if ((m.ret20 ?? 0) >= 30) { riskPts += 1; riskWhy.push(`Up ${r1(m.ret20 ?? 0)}% in 20 sessions: stretched, chasing is risky.`); }
    if (m.upLimitDays10 >= 3) { riskPts += 2; riskWhy.push(`Closed at or near the 10% upper limit ${m.upLimitDays10} times in 10 sessions. Repeated limit-up days in NEPSE are usually driven by a group of large traders.`); }
    const peak30 = Math.max(...last(30).map((x) => x.close));
    if (pct(c, peak30) <= -25 && (m.ret120 ?? 0) > 0) { riskPts += 1; riskWhy.push(`Down ${Math.abs(r1(pct(c, peak30)))}% from its high of the last 30 sessions: possible dump after a pump. Wait for the selling to settle.`); }
    if ((m.volRatio ?? 0) >= 3 && Math.abs(ret5) < 3) riskWhy.push(`Volume ${r1(m.volRatio ?? 0)}x normal with almost no price change: large blocks are changing hands. The broker data below shows which side is bigger.`);
    if (m.marketCapCr != null && m.marketCapCr < 200) { riskPts += 1; riskWhy.push(`Small company (market value about Rs. ${m.marketCapCr} crore, including promoter shares): a few large traders can move the price.`); }
    if (m.avgTurnoverLakh != null && m.avgTurnoverLakh < 50) { riskPts += 1; riskWhy.push(`Thinly traded (about Rs. ${m.avgTurnoverLakh} lakh a day): easy to push up or down, and hard to sell in size.`); }
  }

  // Floorsheet: who is buying and who is selling.
  const dates = [...new Set(inp.brokers.map((x) => x.date))].sort();
  const sessions = dates.length;
  let brokerRead: SmartMoney["brokerRead"] = "Not enough data";
  let topBuyers: BrokerFlow[] = [], topSellers: BrokerFlow[] = [];
  if (sessions >= 1) {
    const by = new Map<number, BrokerFlow & { perDay: Map<string, number> }>();
    for (const r of inp.brokers) {
      const f = by.get(r.broker) ?? { broker: r.broker, buy: 0, sell: 0, net: 0, netDays: 0, days: 0, perDay: new Map() };
      f.buy += r.buyQty; f.sell += r.sellQty; f.net += r.buyQty - r.sellQty;
      f.perDay.set(r.date, (f.perDay.get(r.date) ?? 0) + r.buyQty - r.sellQty);
      by.set(r.broker, f);
    }
    const flows = [...by.values()].map((f) => { const net = f.net; return { broker: f.broker, buy: f.buy, sell: f.sell, net, days: f.perDay.size, netDays: [...f.perDay.values()].filter((x) => (net >= 0 ? x > 0 : x < 0)).length }; });
    const total = flows.reduce((t, f) => t + f.buy, 0);
    if (total > 0) {
      topBuyers = flows.filter((f) => f.net > 0).sort((a, z) => z.net - a.net).slice(0, 5);
      topSellers = flows.filter((f) => f.net < 0).sort((a, z) => a.net - z.net).slice(0, 5);
      const nb = topBuyers.slice(0, 3).reduce((t, f) => t + f.net, 0), ns = -topSellers.slice(0, 3).reduce((t, f) => t + f.net, 0);
      m.top3NetBuyPct = r1((nb / total) * 100); m.top3NetSellPct = r1((ns / total) * 100);
      m.top5BuyPct = r1((flows.map((f) => f.buy).sort((a, z) => z - a).slice(0, 5).reduce((t, x) => t + x, 0) / total) * 100);
      const persistent = topBuyers.slice(0, 3).filter((f) => f.days >= 2 && f.netDays / f.days >= 0.6).length;
      const persistentS = topSellers.slice(0, 3).filter((f) => f.days >= 2 && f.netDays / f.days >= 0.6).length;
      const conc = ns > 0 ? nb / ns : 9;
      const fmt = (f: BrokerFlow) => `broker ${f.broker} (${f.net > 0 ? "+" : ""}${Math.round(f.net).toLocaleString("en-IN")} shares${f.days > 1 ? `, net ${f.net > 0 ? "buyer" : "seller"} on ${f.netDays} of ${f.days} days` : ""})`;
      if (sessions < 3) brokerRead = "Not enough data";
      else if (m.top3NetBuyPct >= 12 && conc >= 1.7 && persistent >= 1) brokerRead = "Accumulation";
      else if (m.top3NetSellPct >= 12 && conc <= 0.6 && persistentS >= 1) brokerRead = "Distribution";
      else brokerRead = "Balanced";
      reasons.push(`Floorsheet, last ${sessions} session${sessions > 1 ? "s" : ""}: the top 3 net buyers took ${m.top3NetBuyPct}% of all shares traded; the top 3 net sellers gave ${m.top3NetSellPct}%.`);
      if (topBuyers[0]) reasons.push(`Biggest net buyers: ${topBuyers.slice(0, 3).map(fmt).join("; ")}.`);
      if (topSellers[0]) reasons.push(`Biggest net sellers: ${topSellers.slice(0, 3).map(fmt).join("; ")}.`);
      if (brokerRead === "Accumulation") reasons.push("Buying is concentrated in a few brokers while selling is spread across many: large players appear to be collecting shares from the public.");
      if (brokerRead === "Distribution") reasons.push("Selling is concentrated in a few brokers while buying is spread across many: large holders appear to be unloading shares to the public.");
      if (sessions < 3) reasons.push(`Only ${sessions} session${sessions > 1 ? "s" : ""} of broker data stored so far, too few to call accumulation or distribution. This grows each trading day.`);
      // Brokers on both sides in size.
      // Needs several sessions: on a single day one busy broker often has clients on both sides.
      const both = sessions >= 3 ? flows.filter((f) => f.buy >= total * 0.12 && f.sell >= total * 0.12 && Math.abs(f.net) < Math.min(f.buy, f.sell) * 0.25) : [];
      if (both.length) { riskPts += 1; riskWhy.push(`Broker ${both.map((f) => f.broker).join(", ")} bought and sold large amounts of it at the same time (each over 12% of volume across several sessions, with little net change): possible circular trading to create volume.`); }
    }
  } else reasons.push("No broker (floorsheet) data stored for this stock yet.");
  const cross = inp.floor.filter((f) => f.crossQty != null && f.qty > 0);
  if (cross.length) {
    const cq = cross.reduce((t, f) => t + (f.crossQty ?? 0), 0), q = cross.reduce((t, f) => t + f.qty, 0);
    m.crossPct = r1((cq / q) * 100);
    // Normal crossing on NEPSE is about 1-2% of shares (checked on the 20 Nov 2026 floorsheet of NABIL, NMB, CFCL, HURJA and others).
    if (m.crossPct >= 20) { riskPts += 2; riskWhy.push(`${m.crossPct}% of the shares traded had the same broker on both sides (crossing), against about 1-2% normally. High crossing can mean shares moving between related accounts rather than real demand.`); }
    else if (m.crossPct >= 8) { riskPts += 1; riskWhy.push(`${m.crossPct}% of the shares traded had the same broker on both sides (crossing), well above the normal 1-2%.`); }
  }
  if (inp.favourite) reasons.push(inp.favourite.side === "buy" ? `Among the most net-bought stocks by the 10 brokers with the highest market turnover this week (rank ${inp.favourite.rank} of ${inp.favourite.of}).` : `Among the most net-sold stocks by the 10 brokers with the highest market turnover this week (rank ${inp.favourite.rank} of ${inp.favourite.of}).`);

  const risk: SmartMoney["risk"] = riskPts >= 3 ? "High" : riskPts >= 1 ? "Medium" : "Low";
  // Verdict: smart money with you, against you, or a manipulation warning.
  let pts = 0;
  if (phase === "Accumulation" || phase === "Markup") pts++;
  if (phase === "Distribution" || phase === "Markdown") pts--;
  if (brokerRead === "Accumulation") pts++;
  if (brokerRead === "Distribution") pts--;
  if (inp.favourite?.side === "buy") pts += 0.5;
  if (inp.favourite?.side === "sell") pts -= 0.5;
  if (risk === "High") pts -= 2;
  const known = n >= 60;
  const verdict: SmartMoney["verdict"] = !known ? "unknown" : pts >= 1.5 ? "positive" : pts <= -1 ? "negative" : "neutral";
  const score = known ? Math.max(0, Math.min(100, Math.round(50 + pts * 18))) : null;
  let blocksBuy: string | null = null;
  if (risk === "High") blocksBuy = "Signs of operator activity (see the smart money section): buying now risks getting caught when the move reverses.";
  else if (phase === "Distribution" && brokerRead !== "Accumulation") blocksBuy = "Price and volume show distribution: large holders appear to be selling.";
  else if (brokerRead === "Distribution") blocksBuy = "Big brokers are net sellers while the public buys.";
  const summary = !known ? "Not enough history to read smart money."
    : `${phase} phase; broker flow: ${brokerRead.toLowerCase()}; manipulation risk ${risk.toLowerCase()}.`;
  return { phase, phaseWhy, risk, riskWhy, brokerRead, sessions, metrics: m, topBuyers, topSellers, verdict, score, summary, reasons: [phaseWhy, ...riskWhy, ...reasons], blocksBuy };
}

/** Stocks the biggest brokers (by turnover, last sessions) are net buying or net selling the most, relative to their turnover. */
export function brokerFavourites(rows: { symbol: string; broker: number; buyAmt: number; sellAmt: number }[], topN = 10) {
  const turnover = new Map<number, number>();
  for (const r of rows) turnover.set(r.broker, (turnover.get(r.broker) ?? 0) + r.buyAmt + r.sellAmt);
  const big = new Set([...turnover.entries()].sort((a, z) => z[1] - a[1]).slice(0, topN).map(([b]) => b));
  const per = new Map<string, { net: number; tot: number; brokers: Set<number> }>();
  const symTot = new Map<string, number>();
  for (const r of rows) {
    symTot.set(r.symbol, (symTot.get(r.symbol) ?? 0) + r.buyAmt);
    if (!big.has(r.broker)) continue;
    const p = per.get(r.symbol) ?? { net: 0, tot: 0, brokers: new Set() };
    p.net += r.buyAmt - r.sellAmt; p.tot += r.buyAmt + r.sellAmt; if (r.buyAmt > r.sellAmt) p.brokers.add(r.broker);
    per.set(r.symbol, p);
  }
  const list = [...per.entries()].map(([symbol, p]) => ({ symbol, netCr: Math.round((p.net / 1e7) * 100) / 100, shareOfTurnoverPct: Math.round((p.net / (symTot.get(symbol) || 1)) * 1000) / 10, buyingBrokers: p.brokers.size }))
    .filter((x) => (symTot.get(x.symbol) ?? 0) >= 5e6);
  const buy = list.filter((x) => x.netCr > 0).sort((a, z) => z.netCr - a.netCr).slice(0, 15);
  const sell = list.filter((x) => x.netCr < 0).sort((a, z) => a.netCr - z.netCr).slice(0, 15);
  return { brokers: [...big], buy, sell };
}
