// The 1-2 week swing list: today's candidates (shared/swing.ts) checked against the full research, plus the honest
// replay of the same rules over the past year. Precomputed in the cloud each day; live prices are applied on request.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import * as TR from "./trading.ts";
import { researchFor } from "./research.ts";
import { swingSeries, swingAt, backtestSwing, stats, SWING_THRESHOLD, SWING_HOLD, type SwingSignal, type SwingStats } from "../../shared/swing.ts";

export interface SwingPick {
  symbol: string; name: string; sector: string; price: number; date: string; score: number; setup: SwingSignal["setup"];
  plan: SwingSignal["plan"]; reasons: string[];
  research: { decision: string; conviction: string; agree: { positive: number; negative: number; known: number }; headline: string; smart: { phase: string; risk: string; brokerRead: string } | null; cautions: string[] } | null;
}
export interface SwingHeld { symbol: string; score: number; why: string }

export function computeSwing() {
  const rows = TR.opportunities().rows.filter((r) => r.action !== "INSUFFICIENT");
  const stocks: { symbol: string; bars: ReturnType<typeof M.bars>["bars"] }[] = [];
  for (const r of rows) { try { const b = M.bars(r.symbol, { limit: 420, official: true }).bars; if (b.length >= 80) stocks.push({ symbol: r.symbol, bars: b }); } catch { /* skip */ } }
  const latest = M.latestTradingDate() ?? "";
  const nepse = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND close > 0 ORDER BY date DESC LIMIT 420").reverse();
  const bt = backtestSwing(stocks, nepse, 250, 5, M.fees());
  const byName = new Map(rows.map((r) => [r.symbol, r]));
  const cands: { symbol: string; sig: SwingSignal; price: number; date: string }[] = [];
  for (const s of stocks) {
    const last = s.bars[s.bars.length - 1];
    if (last.date !== latest) continue; // only stocks that traded in the latest session
    const sig = swingAt(swingSeries(s.bars), s.bars.length - 1);
    if (sig && sig.score >= SWING_THRESHOLD) cands.push({ symbol: s.symbol, sig, price: last.close, date: last.date });
  }
  cands.sort((a, b) => b.sig.score - a.sig.score);
  const picks: SwingPick[] = [], held: SwingHeld[] = [];
  for (const c of cands) {
    const o = byName.get(c.symbol);
    let r: ReturnType<typeof researchFor> = null;
    try { r = researchFor(c.symbol); } catch { /* keep without */ }
    const P = (k: string) => r?.pillars.find((x) => x.key === k)?.verdict;
    // The research must not be against it: a sound-enough business, no bad news, no distribution or operator signs.
    const stopWhy = !r ? null
      : ["SELL", "AVOID", "REDUCE"].includes(r.decision) ? `research says ${r.decision.toLowerCase()}`
      : r.smart?.blocksBuy ? r.smart.blocksBuy.replace(/\.$/, "").toLowerCase()
      : P("business") === "negative" ? "the business is weak"
      : P("news") === "negative" ? "recent news is negative"
      : null;
    if (stopWhy) { held.push({ symbol: c.symbol, score: c.sig.score, why: stopWhy }); continue; }
    const cautions: string[] = [];
    if (P("market") === "negative") cautions.push("The market and sector are falling: use a smaller position.");
    if (P("macro") === "negative") cautions.push("The economic backdrop is negative.");
    if (r?.smart?.risk === "Medium") cautions.push("Some manipulation risk (thin trading, small size or a stretched move).");
    if (P("indicators") === "negative") cautions.push("Most of the 100 indicators disagree.");
    picks.push({
      symbol: c.symbol, name: o?.name ?? c.symbol, sector: o?.sector ?? "", price: c.price, date: c.date, score: c.sig.score, setup: c.sig.setup, plan: c.sig.plan, reasons: c.sig.reasons,
      research: r ? { decision: r.decision, conviction: r.conviction, agree: r.agree, headline: r.headline, smart: r.smart ? { phase: r.smart.phase, risk: r.smart.risk, brokerRead: r.smart.brokerRead } : null, cautions } : null,
    });
  }
  // Rank: score, then how many research areas support it.
  picks.sort((a, b) => (b.score + (b.research?.agree.positive ?? 0) * 3 - (b.research?.agree.negative ?? 0) * 4) - (a.score + (a.research?.agree.positive ?? 0) * 3 - (a.research?.agree.negative ?? 0) * 4));
  const n = all<{ close: number }>("SELECT close FROM indices WHERE index_id = 12 AND close > 0 ORDER BY date DESC LIMIT 50");
  const marketDown = n.length === 50 && n[0].close < n.reduce((t, x) => t + x.close, 0) / 50;
  // How the same rules did: all year, the last 60 sessions, and by setup type. The list only calls itself a buy list
  // when the record is positive both over the year and recently; otherwise it says it is a candidate list.
  const { trades, ...btRest } = bt;
  const cut = [...new Set(trades.map((t) => t.date))].sort().slice(-60)[0] ?? "";
  const recent60 = stats(trades.filter((t) => t.date >= cut));
  const bySetup = (["Breakout", "Pullback", "Momentum"] as const).map((k) => ({ setup: k, ...stats(trades.filter((t) => t.setup === k)) }));
  const ok = (x: SwingStats) => x.trades >= 30 && (x.avgNetPct ?? -1) > 0 && (x.winRatePct ?? 0) >= 45;
  const mode: "buy" | "candidates" = ok(bt.all) && recent60.trades >= 10 && (recent60.avgNetPct ?? -1) > 0 ? "buy" : "candidates";
  return { asOf: latest, studied: stocks.length, candidates: cands.length, picks: picks.slice(0, 12), held: held.slice(0, 12), backtest: { ...btRest, recent60, bySetup }, mode, marketDown, holdDays: SWING_HOLD, threshold: SWING_THRESHOLD };
}

let cache: { key: string; data: ReturnType<typeof computeSwing> } | null = null;
export function swing() {
  const key = M.setupKeyPublic();
  if (cache?.key !== key) cache = { key, data: M.persistedPublic<ReturnType<typeof computeSwing>>("swing", key) ?? computeSwing() };
  // Live check: is today's price still in the buy range?
  const picks = cache.data.picks.map((p) => {
    const q = get<{ close: number; date: string; source: string | null }>("SELECT close, date, source FROM quotes WHERE symbol = ?", p.symbol);
    const now = q?.close ?? p.price, live = q?.source === "live" && q.date > p.date;
    const status = now <= p.plan.stop ? "stop-hit" : now > p.plan.entryHigh ? (now >= p.plan.t1 ? "target-hit" : "above-zone") : now < p.plan.entryLow ? "below-zone" : "in-zone";
    return { ...p, now, live, status };
  });
  return { ...cache.data, picks };
}
