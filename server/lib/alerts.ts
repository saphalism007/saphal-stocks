// Alert evaluation and the daily briefing. Alerts are evaluated against the
// latest stored data only; each notification records the data date it is
// based on, so nothing claims a condition happened when it did not.
import { all, get, run, nowIso } from "../db.ts";
import * as M from "./market.ts";
import { portfolioSummary } from "./portfolioService.ts";
import { technicalSnapshot } from "../../shared/signals.ts";
import { detectPatterns } from "../../shared/patterns.ts";
import { analyzeLevels } from "../../shared/levels.ts";
import { readVault } from "./vault.ts";
import { desktopNotify } from "./desktop.ts";
import { planGoal } from "../../shared/planner.ts";

export const ALERT_TYPES = [
  { type: "price_above", label: "Price rises above", needsSymbol: true, params: ["price"] },
  { type: "price_below", label: "Price falls below (stop-loss)", needsSymbol: true, params: ["price"] },
  { type: "near_support", label: "Approaching major support", needsSymbol: true, params: ["withinPct"] },
  { type: "near_resistance", label: "Approaching major resistance", needsSymbol: true, params: ["withinPct"] },
  { type: "breakout", label: "Breakout confirmed (20-day high on volume)", needsSymbol: true, params: [] },
  { type: "breakdown", label: "Breakdown confirmed (20-day low on volume)", needsSymbol: true, params: [] },
  { type: "rsi_overbought", label: "RSI above level", needsSymbol: true, params: ["level"] },
  { type: "rsi_oversold", label: "RSI below level", needsSymbol: true, params: ["level"] },
  { type: "macd_cross", label: "MACD crossover (either direction)", needsSymbol: true, params: [] },
  { type: "unusual_volume", label: "Unusual volume (x times 20-day average)", needsSymbol: true, params: ["multiple"] },
  { type: "new_report", label: "New quarterly report stored", needsSymbol: true, params: [] },
  { type: "dividend", label: "Dividend / bonus announcement", needsSymbol: true, params: [] },
  { type: "agm", label: "AGM / SGM announcement", needsSymbol: true, params: [] },
  { type: "right_share", label: "Right share announcement", needsSymbol: true, params: [] },
  { type: "disclosure", label: "Any new company announcement", needsSymbol: true, params: [] },
  { type: "ipo", label: "New IPO / FPO announcement (market-wide)", needsSymbol: false, params: [] },
  { type: "fundamental_drop", label: "Fundamental score falls below", needsSymbol: true, params: ["score"] },
  { type: "portfolio_risk", label: "Portfolio health score falls below", needsSymbol: false, params: ["score", "portfolioId"] },
] as const;

interface AlertRow { id: number; user_id: number; symbol: string | null; type: string; params: string | null; note: string | null; repeat: number; last_triggered_at: string | null; last_checked_at: string | null }

function notify(userId: number, alertId: number | null, kind: string, title: string, body: string, symbol: string | null, dataDate: string | null) {
  // De-duplicate: one notification per alert (or per automatic check and title) per data date.
  if (alertId && get("SELECT 1 FROM notifications WHERE alert_id = ? AND data_date IS ?", alertId, dataDate)) return false;
  if (!alertId && get("SELECT 1 FROM notifications WHERE user_id = ? AND alert_id IS NULL AND kind = ? AND title = ? AND data_date IS ?", userId, kind, title, dataDate)) return false;
  run("INSERT INTO notifications (user_id, alert_id, kind, title, body, symbol, data_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", userId, alertId, kind, title, body, symbol, dataDate, nowIso());
  void desktopNotify(title, body);
  return true;
}

export function evaluateAlerts(): number {
  const alerts = all<AlertRow>("SELECT * FROM alerts WHERE active = 1");
  let fired = 0;
  const cache = new Map<string, ReturnType<typeof M.bars>["bars"]>();
  const barsOf = (s: string) => { if (!cache.has(s)) cache.set(s, M.bars(s, { limit: 300 }).bars); return cache.get(s)!; };
  for (const a of alerts) {
    const p = a.params ? JSON.parse(a.params) : {};
    const sym = a.symbol;
    const since = a.last_checked_at || a.last_triggered_at || "1970-01-01";
    let hit: { title: string; body: string; date: string | null } | null = null;
    try {
      if (sym && ["price_above", "price_below", "near_support", "near_resistance", "breakout", "breakdown", "rsi_overbought", "rsi_oversold", "macd_cross", "unusual_volume"].includes(a.type)) {
        const b = barsOf(sym);
        if (b.length < 30) continue;
        const last = b[b.length - 1];
        const snap = technicalSnapshot(b);
        switch (a.type) {
          case "price_above": if (last.close >= p.price) hit = { title: `${sym} closed above Rs. ${p.price}`, body: `Close Rs. ${last.close} on ${last.date}.`, date: last.date }; break;
          case "price_below": if (last.close <= p.price) hit = { title: `${sym} closed below Rs. ${p.price}`, body: `Close Rs. ${last.close} on ${last.date}. Review your stop-loss plan.`, date: last.date }; break;
          case "near_support":
          case "near_resistance": {
            const lv = analyzeLevels(b);
            const within = p.withinPct ?? 2;
            const l = a.type === "near_support" ? lv?.supports.find((x) => x.strength === "major") : lv?.resistances.find((x) => x.strength === "major");
            if (l && Math.abs(l.distancePct) <= within) hit = { title: `${sym} is within ${Math.abs(l.distancePct).toFixed(1)}% of ${a.type === "near_support" ? "support" : "resistance"} Rs. ${l.price}`, body: `${l.reactions} prior reactions. ${l.why} ${l.invalidation}`, date: last.date };
            break;
          }
          case "breakout":
          case "breakdown": {
            const pat = detectPatterns(b).find((x) => x.name === (a.type === "breakout" ? "Breakout" : "Breakdown") && x.status === "confirmed");
            if (pat) hit = { title: `${sym}: ${pat.name.toLowerCase()} confirmed`, body: pat.description, date: last.date };
            break;
          }
          case "rsi_overbought": if (snap?.rsi != null && snap.rsi >= (p.level ?? 70)) hit = { title: `${sym} RSI ${snap.rsi} (above ${p.level ?? 70})`, body: `As of ${last.date}.`, date: last.date }; break;
          case "rsi_oversold": if (snap?.rsi != null && snap.rsi <= (p.level ?? 30)) hit = { title: `${sym} RSI ${snap.rsi} (below ${p.level ?? 30})`, body: `As of ${last.date}.`, date: last.date }; break;
          case "macd_cross": {
            // Only the latest session's cross counts, so the alert describes something that just happened.
            const h = snap?.macd.histogram;
            const prevSnap = technicalSnapshot(b.slice(0, -1));
            const ph = prevSnap?.macd.histogram;
            if (h != null && ph != null && Math.sign(h) !== Math.sign(ph) && h !== 0) hit = { title: `${sym}: ${h > 0 ? "bullish" : "bearish"} MACD crossover`, body: `MACD histogram moved from ${ph} to ${h} on ${last.date}.`, date: last.date };
            break;
          }
          case "unusual_volume": if ((snap?.volumeRatio ?? 0) >= (p.multiple ?? 2.5)) hit = { title: `${sym}: volume ${snap!.volumeRatio}x the 20-day average`, body: `${last.volume.toLocaleString("en-IN")} shares on ${last.date}, close Rs. ${last.close}.`, date: last.date }; break;
        }
      } else if (sym && a.type === "new_report") {
        const r = get<{ period: string; fetched_at: string }>("SELECT period, fetched_at FROM reports WHERE symbol = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1", sym, since);
        if (r) hit = { title: `${sym}: new quarterly report (${r.period})`, body: "Open the Financials tab to see what changed.", date: r.period };
      } else if (sym && ["dividend", "agm", "right_share", "disclosure"].includes(a.type)) {
        const cat = { dividend: "Dividend / bonus", agm: "AGM / SGM", right_share: "Right share", disclosure: "%" }[a.type as "dividend"];
        const r = get<{ title: string; url: string; published_date: string }>("SELECT title, url, published_date FROM announcements WHERE symbol = ? AND category LIKE ? AND fetched_at > ? ORDER BY published_date DESC LIMIT 1", sym, cat, since);
        if (r) hit = { title: `${sym}: ${r.title.slice(0, 120)}`, body: `${r.published_date} · ${r.url}`, date: r.published_date };
      } else if (a.type === "ipo") {
        const r = get<{ title: string; url: string; published_date: string }>("SELECT title, url, published_date FROM announcements WHERE (category = 'IPO / FPO' OR title LIKE '%IPO%' OR title LIKE '%FPO%') AND fetched_at > ? ORDER BY published_date DESC LIMIT 1", since);
        if (r) hit = { title: `IPO/FPO: ${r.title.slice(0, 120)}`, body: `${r.published_date} · ${r.url}`, date: r.published_date };
      } else if (sym && a.type === "fundamental_drop") {
        const fa = M.fundamentalsFor(sym);
        if (fa?.score.overall != null && fa.score.overall < (p.score ?? 40)) hit = { title: `${sym}: fundamental score ${fa.score.overall} (below ${p.score ?? 40})`, body: fa.redFlags.join(" ") || "See the Fundamentals tab.", date: fa.latestPeriod };
      } else if (a.type === "portfolio_risk" && p.portfolioId) {
        const d = portfolioSummary(Number(p.portfolioId));
        if (d.health && d.health.score < (p.score ?? 50)) hit = { title: `Portfolio health ${d.health.score}/100 (below ${p.score ?? 50})`, body: d.health.issues.join(" "), date: d.priceDate };
      }
    } catch (e) {
      console.warn(`[alerts] ${a.id}: ${e instanceof Error ? e.message : e}`);
    }
    run("UPDATE alerts SET last_checked_at = ? WHERE id = ?", nowIso(), a.id);
    if (hit && notify(a.user_id, a.id, a.type, hit.title, hit.body + (a.note ? `\nYour note: ${a.note}` : ""), sym, hit.date)) {
      fired++;
      run("UPDATE alerts SET last_triggered_at = ?, active = ? WHERE id = ?", nowIso(), a.repeat ? 1 : 0, a.id);
    }
  }
  return fired + automaticNotifications();
}

/** Automatic reminders that need no setup: thesis reviews due, and goals falling behind plan (checked monthly). */
export function automaticNotifications(): number {
  let n = 0;
  const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  for (const { id: uid } of all<{ id: number }>("SELECT id FROM users")) {
    try {
      for (const t of readVault<{ symbol: string; reviewOn: string; status: string; thesis: string }>(uid, "thesis")) {
        if (t.data.status === "active" && t.data.reviewOn && t.data.reviewOn <= today && notify(uid, null, "thesis_review", `Review your ${t.data.symbol} thesis`, `Review date ${t.data.reviewOn}. Thesis: ${t.data.thesis.slice(0, 200)}`, t.data.symbol, t.data.reviewOn)) n++;
      }
      for (const g of readVault<Record<string, string | number>>(uid, "goal")) {
        const d = g.data;
        const p = planGoal({ name: String(d.name), costToday: +d.costToday, years: +d.years, inflationPct: +d.inflationPct, currentSaved: +d.currentSaved, monthlyCapacity: +d.monthlyCapacity, annualStepUpPct: +(d.annualStepUpPct ?? 0), investmentCostPct: +(d.investmentCostPct ?? 0), taxOnGainsPct: +(d.taxOnGainsPct ?? 0) });
        const mod = p.scenarios[1];
        if (!Number.isFinite(mod.requiredMonthly)) continue;
        const behind = +d.monthlyCapacity < mod.requiredMonthly * 0.98;
        const title = behind ? `Goal "${d.name}" is behind plan` : `Goal "${d.name}" is on track`;
        const body = behind
          ? `At a moderate ${mod.effectiveReturnPct}% return you need about Rs. ${Math.round(mod.requiredMonthly).toLocaleString("en-IN")}/month; you plan Rs. ${Math.round(+d.monthlyCapacity).toLocaleString("en-IN")}. Update saved amount, monthly amount or timeline in Wealth Planner.`
          : `Your planned Rs. ${Math.round(+d.monthlyCapacity).toLocaleString("en-IN")}/month covers the Rs. ${Math.round(mod.requiredMonthly).toLocaleString("en-IN")} needed in the moderate scenario. Remember to update the saved amount.`;
        if (notify(uid, null, "goal_progress", title, body, null, month)) n++;
      }
    } catch (e) { console.warn(`[alerts] automatic for user ${uid}: ${e instanceof Error ? e.message : e}`); }
  }
  return n;
}

export function dailyBriefing(userId: number) {
  const m = M.marketSummary();
  const date = m.date;
  const nepse = m.indices.find((i) => i.index_id === 12);
  const watch = all<{ symbol: string }>("SELECT DISTINCT wi.symbol FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id WHERE w.user_id = ?", userId).map((r) => r.symbol);
  const ports = all<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM portfolios WHERE user_id = ?", userId);
  const held = new Set<string>();
  const portfolioChanges = ports.map((p) => {
    const d = portfolioSummary(p.id);
    let dayChange = 0;
    const movers: { symbol: string; changePct: number | null; impact: number }[] = [];
    for (const h of d.summary.holdings.filter((x) => x.quantity > 0)) {
      held.add(h.symbol);
      const q = M.quote(h.symbol);
      if (q?.date === date && q.prev_close != null && q.close != null) {
        const imp = h.quantity * ((q.close as number) - (q.prev_close as number));
        dayChange += imp;
        movers.push({ symbol: h.symbol, changePct: q.change_pct as number, impact: Math.round(imp) });
      }
    }
    movers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    return { id: p.id, name: p.name, kind: p.kind, marketValue: d.summary.marketValue, dayChange: Math.round(dayChange), movers: movers.slice(0, 5), healthScore: d.health?.score ?? null, issues: d.health?.issues.slice(0, 3) ?? [] };
  });
  const interest = [...new Set([...watch, ...held])];
  const factors = M.allFactors();
  const myMoves = interest.map((s) => { const q = M.quote(s); return { symbol: s, changePct: (q?.change_pct as number) ?? null, close: (q?.close as number) ?? null, held: held.has(s) }; }).filter((x) => x.changePct != null).sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!)).slice(0, 8);
  const setups = M.allSetups(60);
  const mySetups = setups.filter((s) => interest.includes(s.symbol)).slice(0, 6);
  const topSetups = setups.filter((s) => s.side === "buy").slice(0, 6);
  const warnings = setups.filter((s) => s.side === "sell" && held.has(s.symbol));
  const since = new Date(Date.parse(date || new Date().toISOString()) - 3 * 86_400_000).toISOString().slice(0, 10);
  const reports = all<{ symbol: string; title: string; url: string; published_date: string }>("SELECT symbol, title, url, published_date FROM announcements WHERE category = 'Quarterly report' AND published_date >= ? ORDER BY published_date DESC LIMIT 12", since);
  const myNews = interest.length ? all<{ symbol: string; title: string; url: string; published_date: string; category: string }>(`SELECT symbol, title, url, published_date, category FROM announcements WHERE symbol IN (${interest.map(() => "?").join(",")}) AND published_date >= ? ORDER BY published_date DESC LIMIT 10`, ...interest, since) : [];
  const opportunities = all<{ title: string; url: string; published_date: string; category: string }>("SELECT title, url, published_date, category FROM announcements WHERE (category IN ('IPO / FPO','Right share','Debenture') OR title LIKE '%IPO%' OR title LIKE '%debenture%') AND published_date >= ? ORDER BY published_date DESC LIMIT 8", new Date(Date.parse(date || new Date().toISOString()) - 10 * 86_400_000).toISOString().slice(0, 10));
  const unread = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", userId)?.n ?? 0;
  return {
    date,
    market: {
      nepse: nepse ? { close: nepse.close, change: nepse.change, changePct: nepse.change_pct } : null,
      breadth: m.counts, turnover: m.totals.turnover, trend: m.trend, sentiment: m.sentiment,
      topSectors: [...m.sectors].sort((a, b) => b.avgChange - a.avgChange).slice(0, 3), weakSectors: [...m.sectors].sort((a, b) => a.avgChange - b.avgChange).slice(0, 3),
      gainers: m.gainers.slice(0, 5), losers: m.losers.slice(0, 5),
    },
    attention: myMoves, mySetups, topSetups, warnings, reports, myNews, portfolios: portfolioChanges, opportunities, unreadAlerts: unread,
    factorsCovered: factors.length,
  };
}
