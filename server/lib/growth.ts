// "My Growth": today's action list, a plan for every holding, the trading coach and an events calendar.
// Built only from stored prices, the chart analysis, your portfolios, watchlists and journal.
import { all, get } from "../db.ts";
import * as M from "./market.ts";
import { portfolioSummary } from "./portfolioService.ts";
import { analysisFor } from "./chart.ts";
import { readVault } from "./vault.ts";
import { habitReport, preTrade, holdingAction, wealthRoadmap, type JournalTrade } from "../../shared/coach.ts";
import { moneyOverview } from "./money.ts";
import { xirr } from "../../shared/discover.ts";
import { buyCost, sellCost } from "../../shared/costs.ts";

const todayNpt = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
const daysTo = (d: string, from = todayNpt()) => Math.round((Date.parse(d) - Date.parse(from)) / 86_400_000);
const r2 = (x: number) => Math.round(x * 100) / 100;

function myStocks(userId: number) {
  const ports = all<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM portfolios WHERE user_id = ?", userId);
  const watch = all<{ symbol: string }>("SELECT DISTINCT wi.symbol FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id WHERE w.user_id = ?", userId).map((r) => r.symbol);
  return { ports, watch };
}

/** One row per open holding (real portfolios first) with the chart verdict, levels and today's action. */
export function holdingsPlan(userId: number) {
  const { ports } = myStocks(userId);
  const rows: Record<string, unknown>[] = [];
  const flows: { date: string; amount: number }[] = [];
  const sectorTotals = new Map<string, number>();
  let total = 0;
  for (const p of ports) {
    const d = portfolioSummary(p.id);
    const mv = d.summary.marketValue || 0;
    if (p.kind !== "paper") {
      total += mv;
      // Cash flows for the money-weighted return: buys out, sells and dividends in, today's value at the end.
      const fz = M.fees();
      for (const t of d.transactions) {
        if (t.type === "buy") flows.push({ date: t.date, amount: -(t.commission != null || t.otherCharges != null ? t.quantity * t.price + (t.commission ?? 0) + (t.otherCharges ?? 0) : buyCost(t.quantity, t.price, fz).net) });
        else if (t.type === "sell") flows.push({ date: t.date, amount: (t.commission != null || t.otherCharges != null ? t.quantity * t.price - (t.commission ?? 0) - (t.otherCharges ?? 0) : sellCost(t.quantity, t.price, fz).net) - (t.tax ?? 0) });
        else if (t.type === "ipo" || t.type === "right") flows.push({ date: t.date, amount: -(t.quantity * t.price) });
        else if (t.type === "cash_dividend") flows.push({ date: t.date, amount: t.price - (t.tax ?? t.price * 0.05) });
      }
    }
    const open = d.summary.holdings.filter((x) => x.quantity > 0);
    for (const h of open) {
      const a = analysisFor(h.symbol);
      const weight = mv ? ((h.marketValue ?? 0) / mv) * 100 : 0;
      const sector = d.sectors[h.symbol] ?? "Unknown";
      if (p.kind !== "paper") sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + (h.marketValue ?? 0));
      const zoneHigh = a?.plan.entryHigh ?? a?.plan.bestZone?.high ?? null;
      const act = holdingAction({ symbol: h.symbol, price: h.lastPrice, wacc: r2(h.wacc), weightPct: weight, unrealizedPct: h.unrealizedPct, verdict: a?.verdict ?? null, stop: a?.plan.stop ?? null, t1: a?.plan.targets[0]?.price ?? null, buyZoneHigh: zoneHigh, qty: h.quantity, holdings: open.length });
      const lastDiv = get<{ cash_pct: number | null; fiscal_year: string }>("SELECT cash_pct, fiscal_year FROM dividends WHERE symbol = ? AND cash_pct > 0 ORDER BY fiscal_year DESC LIMIT 1", h.symbol);
      const face = get<{ paid_up_value: number | null }>("SELECT paid_up_value FROM companies WHERE symbol = ?", h.symbol)?.paid_up_value ?? 100;
      rows.push({
        portfolio: p.name, paper: p.kind === "paper", symbol: h.symbol, sector, qty: h.quantity, wacc: r2(h.wacc), price: h.lastPrice, value: h.marketValue, weightPct: r2(weight),
        pnl: h.unrealizedPnl, pnlPct: h.unrealizedPct, netIfSold: h.netIfSoldToday, sellCharges: h.estSellCharges, cgt: h.estCgt, held: h.firstBuyDate ? -daysTo(h.firstBuyDate) : null,
        verdict: a?.verdict ?? null, stop: a?.plan.stop ?? null, t1: a?.plan.targets[0]?.price ?? null, support: a?.levels.find((l) => l.side === "support" && l.price < (h.lastPrice ?? 0))?.price ?? null,
        resistance: a?.levels.find((l) => l.side === "resistance" && l.price > (h.lastPrice ?? 0))?.price ?? null, fundamental: a?.scores.fundamental ?? null,
        expDividend: lastDiv?.cash_pct ? Math.round(h.quantity * (face || 100) * (lastDiv.cash_pct / 100) * 0.95) : null, divYear: lastDiv?.fiscal_year ?? null,
        ...act,
      });
    }
  }
  const order = { urgent: 0, act: 1, watch: 2, ok: 3 } as Record<string, number>;
  rows.sort((a, b) => Number(a.paper) - Number(b.paper) || order[a.level as string] - order[b.level as string] || Number(b.value ?? 0) - Number(a.value ?? 0));
  const sectors = [...sectorTotals.entries()].map(([sector, v]) => ({ sector, pct: total ? r2((v / total) * 100) : 0 })).sort((a, b) => b.pct - a.pct);
  const real = rows.filter((r) => !r.paper);
  const expIncome = real.reduce((s, r) => s + Number(r.expDividend ?? 0), 0);
  if (total > 0) flows.push({ date: todayNpt(), amount: total });
  return { total: Math.round(total), sectors, rows, expectedDividends: expIncome, asOf: M.latestTradingDate(), xirrPct: xirr(flows) };
}

/** Upcoming book closures, open/upcoming issues, recent AGM and book-closure notices; yours first. */
export function calendar(userId: number) {
  const { ports, watch } = myStocks(userId);
  const held = new Set<string>();
  for (const p of ports) for (const h of portfolioSummary(p.id).summary.holdings) if (h.quantity > 0) held.add(h.symbol);
  const mine = (s: string | null) => (s ? (held.has(s) ? "holding" : watch.includes(s) ? "watchlist" : null) : null);
  const t = todayNpt(), back = new Date(Date.parse(t) - 30 * 86_400_000).toISOString().slice(0, 10);
  const books = all<{ symbol: string; fiscal_year: string; cash_pct: number | null; bonus_pct: number | null; bookclose_date: string }>("SELECT symbol, fiscal_year, cash_pct, bonus_pct, bookclose_date FROM dividends WHERE bookclose_date >= ? ORDER BY bookclose_date LIMIT 60", new Date(Date.parse(t) - 3 * 86_400_000).toISOString().slice(0, 10))
    .map((b) => ({ ...b, days: daysTo(b.bookclose_date), mine: mine(b.symbol) }));
  const issues = all<{ issue_type: string; symbol: string | null; company: string | null; units: number | null; price: number | null; ratio: string | null; opening_date: string; closing_date: string }>("SELECT issue_type, symbol, company, units, price, ratio, opening_date, closing_date FROM issues WHERE closing_date >= ? AND opening_date <> '' GROUP BY issue_type, company, opening_date ORDER BY opening_date LIMIT 40", t)
    .map((i) => ({ ...i, open: i.opening_date <= t, daysToOpen: daysTo(i.opening_date), daysToClose: daysTo(i.closing_date), mine: mine(i.symbol) }));
  const notices = all<{ symbol: string | null; title: string; url: string; published_date: string; category: string }>("SELECT symbol, title, url, published_date, category FROM announcements WHERE category IN ('AGM / SGM','Book closure','Dividend / bonus','Right share') AND published_date >= ? ORDER BY published_date DESC LIMIT 80", back)
    .map((n) => ({ ...n, mine: mine(n.symbol) }));
  const sortMine = <T extends { mine: string | null }>(xs: T[]) => [...xs.filter((x) => x.mine), ...xs.filter((x) => !x.mine)];
  return { today: t, bookClosures: sortMine(books), issues: sortMine(issues), notices: sortMine(notices).slice(0, 40), heldCount: held.size };
}

/** Today's checklist: the few things that need you, most urgent first. */
export function today(userId: number) {
  const items: { level: "urgent" | "act" | "info"; title: string; text: string; to?: string }[] = [];
  const plan = holdingsPlan(userId);
  for (const r of plan.rows) if (r.level === "urgent" || r.level === "act") items.push({ level: r.level as "urgent" | "act", title: `${r.symbol}: ${r.action}`, text: `${r.why}${r.paper ? " (paper portfolio)" : ""}`, to: `/terminal/${r.symbol}` });
  const { watch } = myStocks(userId);
  for (const s of watch.slice(0, 40)) {
    const a = analysisFor(s); if (!a || a.price == null) continue;
    const zl = a.plan.entryLow ?? a.plan.bestZone?.low, zh = a.plan.entryHigh ?? a.plan.bestZone?.high;
    if (/BUY/.test(a.verdict) && zl != null && zh != null && a.price <= zh * 1.01) items.push({ level: "act", title: `${s}: in the buy zone`, text: `${a.verdict}, buy Rs. ${zl}-${zh}, stop Rs. ${a.plan.stop ?? "-"}, target Rs. ${a.plan.targets[0]?.price ?? "-"}.`, to: `/terminal/${s}` });
    else if (a.plan.breakout && a.price > a.plan.breakout.price) items.push({ level: "info", title: `${s}: broke above Rs. ${a.plan.breakout.price}`, text: "Check the volume before buying a breakout.", to: `/terminal/${s}` });
  }
  const cal = calendar(userId);
  for (const b of cal.bookClosures.filter((x) => x.mine && x.days >= 0 && x.days <= 10)) items.push({ level: "info", title: `${b.symbol}: book closure in ${b.days} day${b.days === 1 ? "" : "s"}`, text: `${b.cash_pct ? `${b.cash_pct}% cash` : ""}${b.cash_pct && b.bonus_pct ? " + " : ""}${b.bonus_pct ? `${b.bonus_pct}% bonus` : ""} (${b.fiscal_year}). Hold through ${b.bookclose_date} to receive it.`, to: `/stocks/${b.symbol}?tab=dividends` });
  for (const i of cal.issues.filter((x) => x.open && x.daysToClose <= 2)) items.push({ level: "info", title: `${i.company ?? i.symbol}: ${i.issue_type} closes ${i.daysToClose <= 0 ? "today" : `in ${i.daysToClose} day${i.daysToClose === 1 ? "" : "s"}`}`, text: `Apply in MeroShare before ${i.closing_date}${i.mine ? " (you hold or watch this stock)" : ""}.`, to: "/ipo" });
  const t = todayNpt();
  for (const th of readVault<{ symbol: string; status: string; reviewOn: string }>(userId, "thesis").map((r) => r.data)) if (th.status === "active" && th.reviewOn && th.reviewOn <= t) items.push({ level: "info", title: `${th.symbol}: thesis review due`, text: `Due ${th.reviewOn}. Check whether the reasons you invested still hold.`, to: "/journal" });
  for (const tr of readVault<JournalTrade>(userId, "journal").map((r) => r.data).filter((x) => !(x.exit != null && x.exit > 0))) {
    const q = M.quote(tr.symbol), c = (q?.close as number | undefined) ?? null; if (c == null) continue;
    if (tr.stop > 0 && c < tr.stop) items.push({ level: "urgent", title: `${tr.symbol}: journal trade hit its stop`, text: `Close Rs. ${c} is below your stop Rs. ${tr.stop}. Sell and log the exit.`, to: "/journal" });
    else if (tr.target > 0 && c >= tr.target) items.push({ level: "act", title: `${tr.symbol}: journal trade reached its target`, text: `Close Rs. ${c} at least target Rs. ${tr.target}. Take profit as planned and log it.`, to: "/journal" });
  }
  const unread = get<{ n: number }>("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0", userId)?.n ?? 0;
  if (unread) items.push({ level: "info", title: `${unread} unread alert${unread === 1 ? "" : "s"}`, text: "Price and signal alerts that fired.", to: "/alerts" });
  const order = { urgent: 0, act: 1, info: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return { date: M.latestTradingDate(), items, holdings: plan.rows.filter((r) => !r.paper).length, watch: watch.length };
}

export function coach(userId: number) {
  const trades = readVault<JournalTrade>(userId, "journal").map((r) => r.data);
  return habitReport(trades);
}

export function preTradeFor(userId: number, symbol: string, capital: number, riskPct: number) {
  const a = analysisFor(symbol);
  if (!a || a.price == null) return null;
  const f = M.allFactors().find((x) => x.symbol === symbol);
  const plan = holdingsPlan(userId);
  const sector = a.sector;
  const realTotal = plan.total;
  const sectorNow = plan.rows.filter((r) => !r.paper && r.sector === sector).reduce((s, r) => s + Number(r.value ?? 0), 0);
  const stop = a.plan.stop, target = a.plan.targets.find((t) => t.price > (a.price as number))?.price ?? null;
  const tmp = preTrade({ price: a.price, entryHigh: a.plan.entryHigh ?? a.plan.bestZone?.high ?? null, stop, target, verdict: a.verdict, capital, riskPct, avgTurnover: f?.avgTurnover20 ?? null, sectorWeightAfterPct: null, daysToBookClose: null, openPositions: 0 });
  const after = realTotal + tmp.cost;
  const book = get<{ bookclose_date: string }>("SELECT bookclose_date FROM dividends WHERE symbol = ? AND bookclose_date >= ? ORDER BY bookclose_date LIMIT 1", symbol, todayNpt());
  const open = readVault<JournalTrade>(userId, "journal").filter((r) => !(r.data.exit != null && r.data.exit > 0)).length;
  const res = preTrade({ price: a.price, entryHigh: a.plan.entryHigh ?? a.plan.bestZone?.high ?? null, stop, target, verdict: a.verdict, capital, riskPct, avgTurnover: f?.avgTurnover20 ?? null, sectorWeightAfterPct: realTotal > 0 ? ((sectorNow + tmp.cost) / after) * 100 : null, daysToBookClose: book ? daysTo(book.bookclose_date) : null, openPositions: open });
  return { symbol, name: a.name, sector, price: a.price, verdict: a.verdict, stop, target, entryLow: a.plan.entryLow ?? a.plan.bestZone?.low ?? null, entryHigh: a.plan.entryHigh ?? a.plan.bestZone?.high ?? null, setup: a.headline, ...res };
}

export function roadmap(userId: number) {
  const o = moneyOverview(userId);
  const plan = holdingsPlan(userId);
  const holdings = plan.rows.filter((r) => !r.paper).length;
  const steps = wealthRoadmap(o.summary, { accounts: o.data.accounts, liabilities: o.data.liabilities, emergencyMonths: o.data.emergencyMonths, saved: o.saved }, { holdings, sectorTopPct: plan.sectors[0]?.pct ?? null, journalTrades: readVault(userId, "journal").length });
  return { steps, netWorth: o.summary.netWorth, savingsRatePct: o.summary.savingsRatePct, saved: o.saved };
}
