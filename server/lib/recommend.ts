// What the app recommends for one stock right now (the trade signal, the 1-2 week list and the research verdict),
// and what it recommended around a past date. Saved with each purchase so the plan you bought on is never lost.
import { all, get } from "../db.ts";
import * as TR from "./trading.ts";
import { swing } from "./swing.ts";
import { researchFor } from "./research.ts";

export interface RecItem { source: "trade" | "swing" | "research"; label: string; date: string | null; decision: string; setup: string | null; entryLow: number | null; entryHigh: number | null; stop: number | null; t1: number | null; t2: number | null; holdDays: number | null; note?: string }
export interface RecSnapshot { at: string; asOf: string | null; items: RecItem[] }

const SRC_LABEL: Record<RecItem["source"], string> = { trade: "Trade signal", swing: "Buy and hold 1-2 weeks", research: "Research verdict" };

export function recommendationNow(symbol: string): RecSnapshot {
  const sym = symbol.toUpperCase();
  const items: RecItem[] = [];
  const o = TR.withLive(TR.opportunities().rows.filter((r) => r.symbol === sym))[0];
  if (o && (o.action === "BUY" || (o.action === "WATCH" && o.entryLow != null) || o.action === "HOLD" || o.action === "SELL" || o.action === "AVOID")) {
    items.push({ source: "trade", label: SRC_LABEL.trade, date: o.priceDate, decision: o.action, setup: o.setupType, entryLow: o.entryLow, entryHigh: o.entryHigh, stop: o.stop, t1: o.targets[0]?.price ?? null, t2: o.targets[1]?.price ?? null, holdDays: null, note: o.headline });
  }
  try {
    const sw = swing();
    const p = sw.picks.find((x) => x.symbol === sym);
    if (p) items.push({ source: "swing", label: SRC_LABEL.swing, date: p.date, decision: sw.mode === "buy" ? "BUY" : "CANDIDATE", setup: p.setup, entryLow: p.plan.entryLow, entryHigh: p.plan.entryHigh, stop: p.plan.stop, t1: p.plan.t1, t2: p.plan.t2, holdDays: p.plan.exitBy, note: sw.mode === "buy" ? undefined : "Listed as a candidate: these rules have a negative past-year record." });
  } catch { /* swing list unavailable */ }
  try {
    const r = researchFor(sym);
    if (r) items.push({ source: "research", label: SRC_LABEL.research, date: r.asOf, decision: r.decision, setup: null, entryLow: null, entryHigh: null, stop: null, t1: null, t2: null, holdDays: null, note: r.headline });
  } catch { /* research unavailable */ }
  return { at: new Date().toISOString(), asOf: o?.priceDate ?? null, items };
}

/** The buy-type recommendation in force on a date: the latest within the 14 days before it (logged, or the signal log). */
export function recommendationOn(symbol: string, date: string): RecItem | null {
  const sym = symbol.toUpperCase();
  try {
    const r = get<{ date: string; source: RecItem["source"]; decision: string; setup: string | null; entry_low: number | null; entry_high: number | null; stop: number | null; t1: number | null; t2: number | null; hold_days: number | null }>(
      "SELECT * FROM rec_log WHERE symbol = ? AND date <= ? AND date >= date(?, '-14 days') AND source IN ('trade', 'swing') AND stop IS NOT NULL ORDER BY date DESC, CASE source WHEN 'trade' THEN 0 ELSE 1 END LIMIT 1", sym, date, date);
    if (r) return { source: r.source, label: SRC_LABEL[r.source], date: r.date, decision: r.decision, setup: r.setup, entryLow: r.entry_low, entryHigh: r.entry_high, stop: r.stop, t1: r.t1, t2: r.t2, holdDays: r.hold_days };
  } catch { /* older data without the log */ }
  try {
    const s = get<{ date: string; setup: string | null; entry_low: number | null; entry_high: number | null; stop: number | null; t1: number | null; t2: number | null }>(
      "SELECT date, setup, entry_low, entry_high, stop, t1, t2 FROM signal_log WHERE symbol = ? AND action = 'BUY' AND date <= ? AND date >= date(?, '-14 days') ORDER BY date DESC LIMIT 1", sym, date, date);
    if (s) return { source: "trade", label: SRC_LABEL.trade, date: s.date, decision: "BUY", setup: s.setup, entryLow: s.entry_low, entryHigh: s.entry_high, stop: s.stop, t1: s.t1, t2: s.t2, holdDays: null };
  } catch { /* none */ }
  return null;
}

/** The plan snapshot saved with a purchase, if any. */
export function savedPlan(txId: number): RecSnapshot | null {
  try { const r = get<{ plan: string }>("SELECT plan FROM tx_plans WHERE tx_id = ?", txId); return r ? (JSON.parse(r.plan) as RecSnapshot) : null; } catch { return null; }
}
export function savedPlans(txIds: number[]): Map<number, RecSnapshot> {
  const out = new Map<number, RecSnapshot>();
  if (!txIds.length) return out;
  try { for (const r of all<{ tx_id: number; plan: string }>(`SELECT tx_id, plan FROM tx_plans WHERE tx_id IN (${txIds.map(() => "?").join(",")})`, ...txIds)) { try { out.set(r.tx_id, JSON.parse(r.plan)); } catch { /* skip */ } } } catch { /* table missing */ }
  return out;
}
