import { Router, type Request } from "express";
import { z } from "zod";
import { all, get, run, nowIso } from "../db.ts";
import { portfolioSummary, txsFor, latestPrices } from "../lib/portfolioService.ts";
import * as M from "../lib/market.ts";
import { ALERT_TYPES, evaluateAlerts, dailyBriefing } from "../lib/alerts.ts";
import { buyCost, sellCost } from "../../shared/costs.ts";
import { computeHoldings, portfolioTimeline, nepaliFiscalYear } from "../../shared/portfolio.ts";
import { getSetting, setSetting } from "../db.ts";

export const portfolioRouter = Router();
const SYM = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uid = (req: Request) => req.userId!;

function ownPortfolio(req: Request, id: number) {
  const p = get<{ id: number; name: string; kind: string; strategy: string | null; notes: string | null; paper_cash: number | null }>("SELECT * FROM portfolios WHERE id = ? AND user_id = ?", id, uid(req));
  if (!p) throw Object.assign(new Error("Portfolio not found"), { status: 404 });
  return p;
}

portfolioRouter.get("/portfolios", (req, res) => {
  const ports = all<{ id: number; name: string; kind: string; strategy: string | null; paper_cash: number | null }>("SELECT * FROM portfolios WHERE user_id = ? ORDER BY id", uid(req));
  res.json(ports.map((p) => {
    const d = portfolioSummary(p.id);
    return { ...p, invested: d.summary.invested, marketValue: d.summary.marketValue, unrealizedPnl: d.summary.unrealizedPnl, realizedPnl: d.summary.realizedPnl, dividends: d.summary.dividends, totalReturnPct: d.summary.totalReturnPct, holdings: d.summary.holdings.filter((h) => h.quantity > 0).length, healthScore: d.health?.score ?? null, cash: p.kind === "paper" ? paperCash(p.id, p.paper_cash ?? 0) : null };
  }));
});

const portfolioBody = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["real", "paper"]).default("real"), strategy: z.string().max(80).nullable().optional(), notes: z.string().max(2000).nullable().optional(), paperCash: z.number().min(0).max(1e10).optional() });

portfolioRouter.post("/portfolios", (req, res) => {
  const p = portfolioBody.parse(req.body);
  const id = Number(run("INSERT INTO portfolios (user_id, name, kind, strategy, notes, paper_cash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", uid(req), p.name, p.kind, p.strategy ?? null, p.notes ?? null, p.kind === "paper" ? p.paperCash ?? 1_000_000 : null, nowIso()).lastInsertRowid);
  res.json({ id });
});

portfolioRouter.patch("/portfolios/:id", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const b = portfolioBody.partial().parse(req.body);
  run("UPDATE portfolios SET name = ?, strategy = ?, notes = ?, paper_cash = ? WHERE id = ?", b.name ?? p.name, b.strategy ?? p.strategy, b.notes ?? p.notes, b.paperCash ?? p.paper_cash, p.id);
  res.json({ ok: true });
});

portfolioRouter.delete("/portfolios/:id", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  run("DELETE FROM portfolios WHERE id = ?", p.id);
  res.json({ ok: true });
});

function paperCash(portfolioId: number, start: number) {
  const s = computeHoldings(txsFor(portfolioId), {}, M.fees());
  return start - s.cashIn + s.cashOut;
}

portfolioRouter.get("/portfolios/:id", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const d = portfolioSummary(p.id);
  res.json({ portfolio: p, ...d, cash: p.kind === "paper" ? paperCash(p.id, p.paper_cash ?? 0) : null });
});

const txBody = z.object({
  symbol: SYM, type: z.enum(["buy", "sell", "ipo", "right", "bonus", "cash_dividend", "merger_in", "merger_out"]), date: DATE,
  quantity: z.number().min(0).max(1e9), price: z.number().min(0).max(1e9),
  commission: z.number().min(0).nullable().optional(), otherCharges: z.number().min(0).nullable().optional(), tax: z.number().min(0).nullable().optional(), notes: z.string().max(1000).nullable().optional(),
});

portfolioRouter.post("/portfolios/:id/transactions", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const t = txBody.parse(req.body);
  if (t.type !== "cash_dividend" && t.quantity <= 0) return res.status(400).json({ error: "Quantity must be positive." });
  if (["sell", "merger_out"].includes(t.type)) {
    const held = computeHoldings(txsFor(p.id).filter((x) => x.date <= t.date), {}).holdings.find((h) => h.symbol === t.symbol)?.quantity ?? 0;
    if (t.quantity > held) return res.status(400).json({ error: `You held ${held} ${t.symbol} shares on ${t.date}; cannot sell ${t.quantity}.` });
  }
  if (!get("SELECT 1 FROM companies WHERE symbol = ?", t.symbol)) return res.status(400).json({ error: `Unknown symbol ${t.symbol}.` });
  const id = Number(run("INSERT INTO transactions (portfolio_id, symbol, type, date, quantity, price, commission, other_charges, tax, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    p.id, t.symbol, t.type, t.date, t.quantity, t.price, t.commission ?? null, t.otherCharges ?? null, t.tax ?? null, t.notes ?? null, nowIso()).lastInsertRowid);
  res.json({ id });
});

function ownTx(req: Request, id: number) {
  const t = get<{ id: number; portfolio_id: number }>("SELECT t.id, t.portfolio_id FROM transactions t JOIN portfolios p ON p.id = t.portfolio_id WHERE t.id = ? AND p.user_id = ?", id, uid(req));
  if (!t) throw Object.assign(new Error("Transaction not found"), { status: 404 });
  return t;
}

portfolioRouter.put("/transactions/:id", (req, res) => {
  const t0 = ownTx(req, Number(req.params.id));
  const t = txBody.parse(req.body);
  run("UPDATE transactions SET symbol = ?, type = ?, date = ?, quantity = ?, price = ?, commission = ?, other_charges = ?, tax = ?, notes = ? WHERE id = ?", t.symbol, t.type, t.date, t.quantity, t.price, t.commission ?? null, t.otherCharges ?? null, t.tax ?? null, t.notes ?? null, t0.id);
  res.json({ ok: true });
});

portfolioRouter.delete("/transactions/:id", (req, res) => {
  const t = ownTx(req, Number(req.params.id));
  run("DELETE FROM transactions WHERE id = ?", t.id);
  res.json({ ok: true });
});

portfolioRouter.post("/portfolios/:id/paper-order", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  if (p.kind !== "paper") return res.status(400).json({ error: "Paper orders are only for paper portfolios." });
  const o = z.object({ symbol: SYM, side: z.enum(["buy", "sell"]), quantity: z.number().int().positive().max(1e7), price: z.number().positive().optional(), notes: z.string().max(500).optional() }).parse(req.body);
  const q = M.quote(o.symbol);
  const price = o.price ?? (q?.close as number | undefined);
  if (!price) return res.status(400).json({ error: "No latest price for this symbol." });
  const date = (q?.date as string) || new Date().toISOString().slice(0, 10);
  if (o.side === "buy") {
    const cost = buyCost(o.quantity, price, M.fees()).net;
    const cash = paperCash(p.id, p.paper_cash ?? 0);
    if (cost > cash) return res.status(400).json({ error: `Not enough paper cash (need Rs. ${cost.toFixed(2)}, have Rs. ${cash.toFixed(2)}).` });
  } else {
    const held = computeHoldings(txsFor(p.id), {}).holdings.find((h) => h.symbol === o.symbol)?.quantity ?? 0;
    if (o.quantity > held) return res.status(400).json({ error: `You hold ${held} shares.` });
  }
  run("INSERT INTO transactions (portfolio_id, symbol, type, date, quantity, price, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", p.id, o.symbol, o.side, date, o.quantity, price, `Paper order at ${o.price ? "limit" : "last close"} Rs. ${price}${o.notes ? " · " + o.notes : ""}`, nowIso());
  res.json({ ok: true, price, date, estCharges: o.side === "buy" ? buyCost(o.quantity, price, M.fees()).total : sellCost(o.quantity, price, M.fees()).total });
});

portfolioRouter.post("/portfolios/:id/import-csv", (req, res) => {
  // CSV columns: date,symbol,type,quantity,price[,commission,other_charges,tax,notes]
  const p = ownPortfolio(req, Number(req.params.id));
  const { csv } = z.object({ csv: z.string().max(2_000_000) }).parse(req.body);
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (/date/i.test(lines[0])) lines.shift();
  const errors: string[] = [];
  let ok = 0;
  lines.forEach((line, i) => {
    const c = line.split(",").map((x) => x.trim());
    const parsed = txBody.safeParse({ date: c[0], symbol: c[1], type: (c[2] || "").toLowerCase(), quantity: Number(c[3]), price: Number(c[4]), commission: c[5] ? Number(c[5]) : null, otherCharges: c[6] ? Number(c[6]) : null, tax: c[7] ? Number(c[7]) : null, notes: c[8] || null });
    if (!parsed.success) { errors.push(`Line ${i + 2}: ${parsed.error.issues.map((x) => x.path.join(".") + " " + x.message).join("; ")}`); return; }
    const t = parsed.data;
    run("INSERT INTO transactions (portfolio_id, symbol, type, date, quantity, price, commission, other_charges, tax, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", p.id, t.symbol, t.type, t.date, t.quantity, t.price, t.commission ?? null, t.otherCharges ?? null, t.tax ?? null, t.notes ?? null, nowIso());
    ok++;
  });
  res.json({ imported: ok, errors });
});

// ---------- watchlists ----------
portfolioRouter.get("/watchlists", (req, res) => {
  const lists = all<{ id: number; name: string }>("SELECT id, name FROM watchlists WHERE user_id = ? ORDER BY id", uid(req));
  const factors = new Map(M.allFactors().map((f) => [f.symbol, f]));
  res.json(lists.map((l) => ({
    ...l,
    items: all<{ symbol: string; note: string | null; target_price: number | null; stop_price: number | null; added_at: string }>("SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY added_at", l.id).map((i) => {
      const q = M.quote(i.symbol);
      const f = factors.get(i.symbol);
      return { ...i, name: f?.name ?? null, sector: f?.sector ?? null, close: q?.close ?? null, changePct: q?.change_pct ?? null, date: q?.date ?? null, fundamentalScore: f?.fundamentalScore ?? null, technicalScore: f?.technicalScore ?? null, rsi: f?.rsi ?? null, trend: f?.trend ?? null, setup: f?.setupType ?? null, return3m: f?.return3m ?? null };
    }),
  })));
});

portfolioRouter.post("/watchlists", (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  res.json({ id: Number(run("INSERT INTO watchlists (user_id, name, created_at) VALUES (?, ?, ?)", uid(req), name, nowIso()).lastInsertRowid) });
});

function ownList(req: Request, id: number) {
  const l = get<{ id: number }>("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", id, uid(req));
  if (!l) throw Object.assign(new Error("Watchlist not found"), { status: 404 });
  return l;
}

portfolioRouter.delete("/watchlists/:id", (req, res) => { run("DELETE FROM watchlists WHERE id = ?", ownList(req, Number(req.params.id)).id); res.json({ ok: true }); });

portfolioRouter.post("/watchlists/:id/items", (req, res) => {
  const l = ownList(req, Number(req.params.id));
  const b = z.object({ symbol: SYM, note: z.string().max(500).nullable().optional(), targetPrice: z.number().positive().nullable().optional(), stopPrice: z.number().positive().nullable().optional() }).parse(req.body);
  if (!get("SELECT 1 FROM companies WHERE symbol = ?", b.symbol)) return res.status(400).json({ error: `Unknown symbol ${b.symbol}` });
  run(`INSERT INTO watchlist_items (watchlist_id, symbol, note, target_price, stop_price, added_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(watchlist_id, symbol) DO UPDATE SET note = excluded.note, target_price = excluded.target_price, stop_price = excluded.stop_price`, l.id, b.symbol, b.note ?? null, b.targetPrice ?? null, b.stopPrice ?? null, nowIso());
  res.json({ ok: true });
});

portfolioRouter.delete("/watchlists/:id/items/:symbol", (req, res) => {
  run("DELETE FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?", ownList(req, Number(req.params.id)).id, SYM.parse(req.params.symbol));
  res.json({ ok: true });
});

// ---------- alerts & notifications ----------
portfolioRouter.get("/alerts/types", (_req, res) => res.json(ALERT_TYPES));
portfolioRouter.get("/alerts", (req, res) => res.json(all("SELECT * FROM alerts WHERE user_id = ? ORDER BY active DESC, id DESC", uid(req)).map((a) => ({ ...a, params: a.params ? JSON.parse(a.params as string) : {} }))));

portfolioRouter.post("/alerts", (req, res) => {
  const b = z.object({ type: z.enum(ALERT_TYPES.map((t) => t.type) as [string, ...string[]]), symbol: SYM.nullable().optional(), params: z.record(z.number()).default({}), note: z.string().max(500).nullable().optional(), repeat: z.boolean().default(false) }).parse(req.body);
  const def = ALERT_TYPES.find((t) => t.type === b.type)!;
  if (def.needsSymbol && !b.symbol) return res.status(400).json({ error: "This alert needs a stock symbol." });
  const id = Number(run("INSERT INTO alerts (user_id, symbol, type, params, note, repeat, created_at, last_checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", uid(req), b.symbol ?? null, b.type, JSON.stringify(b.params), b.note ?? null, b.repeat ? 1 : 0, nowIso(), nowIso()).lastInsertRowid);
  res.json({ id });
});

portfolioRouter.patch("/alerts/:id", (req, res) => {
  const b = z.object({ active: z.boolean() }).parse(req.body);
  run("UPDATE alerts SET active = ? WHERE id = ? AND user_id = ?", b.active ? 1 : 0, Number(req.params.id), uid(req));
  res.json({ ok: true });
});
portfolioRouter.delete("/alerts/:id", (req, res) => { run("DELETE FROM alerts WHERE id = ? AND user_id = ?", Number(req.params.id), uid(req)); res.json({ ok: true }); });
portfolioRouter.post("/alerts/evaluate", (_req, res) => res.json({ fired: evaluateAlerts() }));

portfolioRouter.get("/notifications", (req, res) => res.json(all("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 200", uid(req))));
portfolioRouter.post("/notifications/read", (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number()).optional() }).parse(req.body);
  if (ids?.length) run(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`, uid(req), ...ids);
  else run("UPDATE notifications SET read = 1 WHERE user_id = ?", uid(req));
  res.json({ ok: true });
});

portfolioRouter.get("/briefing", (req, res) => res.json(dailyBriefing(uid(req))));

portfolioRouter.get("/prices/latest", (req, res) => {
  const syms = String(req.query.symbols || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{1,12}$/.test(s)).slice(0, 200);
  res.json(latestPrices(syms));
});

// ---------- performance history ----------
portfolioRouter.get("/portfolios/:id/history", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const txs = txsFor(p.id);
  if (!txs.length) return res.json({ points: [], stats: null });
  const start = txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date);
  const syms = [...new Set(txs.map((t) => t.symbol))];
  const prices: Record<string, [string, number][]> = {};
  // Unadjusted prices: transaction quantities are actual share counts (bonus shares are recorded as transactions).
  for (const s of syms) prices[s] = all<{ date: string; close: number }>("SELECT date, close FROM prices WHERE symbol = ? AND date >= date(?, '-30 days') ORDER BY date", s, start).map((r) => [r.date, r.close]);
  const idx = all<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND date >= ? ORDER BY date", start);
  let dates = idx.map((r) => r.date);
  if (!dates.length) dates = all<{ date: string }>("SELECT DISTINCT date FROM prices WHERE date >= ? ORDER BY date", start).map((r) => r.date);
  const bench = Object.fromEntries(idx.map((r) => [r.date, r.close]));
  const points = portfolioTimeline(txs, prices, dates, bench, M.fees());
  const lastP = points[points.length - 1];
  let peak = 0, mdd = 0;
  for (const pt of points) { peak = Math.max(peak, pt.twrIndex); if (peak > 0) mdd = Math.max(mdd, (peak - pt.twrIndex) / peak); }
  const years = points.length > 1 ? (Date.parse(lastP.date) - Date.parse(points[0].date)) / (365.25 * 86_400_000) : 0;
  res.json({
    points,
    stats: lastP ? {
      from: points[0].date, to: lastP.date, value: lastP.value, netInvested: lastP.netInvested,
      twrPct: Math.round((lastP.twrIndex - 100) * 100) / 100,
      twrAnnualPct: years >= 1 ? Math.round((Math.pow(lastP.twrIndex / 100, 1 / years) - 1) * 10000) / 100 : null,
      benchmarkPct: lastP.benchmark != null ? Math.round((lastP.benchmark - 100) * 100) / 100 : null,
      maxDrawdownPct: Math.round(mdd * 10000) / 100,
    } : null,
    method: "Time-weighted return: each day's return excludes money you added or withdrew, so it measures your stock selection and timing, comparable with the NEPSE index. Uses actual (unadjusted) closing prices and your recorded bonus/right transactions.",
  });
});

// ---------- tax report by Nepali fiscal year ----------
function taxReport(portfolioId: number, fyStart: string) {
  const s = computeHoldings(txsFor(portfolioId), {}, M.fees());
  const byFy = new Map<string, { fy: string; realizedGain: number; realizedLoss: number; cgt: number; cgtEstimated: boolean; sells: number; dividendsGross: number; dividendTax: number }>();
  const row = (fy: string) => { let r = byFy.get(fy); if (!r) { r = { fy, realizedGain: 0, realizedLoss: 0, cgt: 0, cgtEstimated: false, sells: 0, dividendsGross: 0, dividendTax: 0 }; byFy.set(fy, r); } return r; };
  for (const e of s.realizedEvents) { const r = row(nepaliFiscalYear(e.date, fyStart)); if (e.gain >= 0) r.realizedGain += e.gain; else r.realizedLoss += -e.gain; r.cgt += e.tax; r.sells++; if (e.taxEstimated) r.cgtEstimated = true; }
  for (const e of s.dividendEvents) { const r = row(nepaliFiscalYear(e.date, fyStart)); r.dividendsGross += e.gross; r.dividendTax += e.tax; }
  return {
    fyStart, years: [...byFy.values()].sort((a, b) => (a.fy < b.fy ? 1 : -1)),
    sells: s.realizedEvents.map((e) => ({ ...e, fy: nepaliFiscalYear(e.date, fyStart), longTerm: e.holdingDays > M.fees().holdingDaysForLongTerm })),
    dividends: s.dividendEvents.map((e) => ({ ...e, fy: nepaliFiscalYear(e.date, fyStart) })),
    notes: [
      "Capital gains tax on listed shares is a final withholding tax deducted by the broker at sale; amounts marked estimated were calculated from your holding period because you did not record the actual tax.",
      "Losses on listed shares cannot normally be set off against gains for this final withholding tax; check with a tax professional or IRD for your situation.",
      "Fiscal years are mapped from AD dates using the fiscal year start day set below (Shrawan 1 falls on 16 or 17 July).",
    ],
  };
}

portfolioRouter.get("/portfolios/:id/tax-report", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const fyStart = typeof req.query.fyStart === "string" && /^\d{2}-\d{2}$/.test(req.query.fyStart) ? req.query.fyStart : getSetting("fyStart", "07-16");
  if (typeof req.query.fyStart === "string") setSetting("fyStart", fyStart);
  res.json(taxReport(p.id, fyStart));
});

// ---------- CSV exports ----------
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";
const sendCsv = (res: import("express").Response, name: string, body: string) => { res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${name}"`); res.send(body); };
const safeName = (s: string) => s.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();

portfolioRouter.get("/portfolios/:id/export/:what", (req, res) => {
  const p = ownPortfolio(req, Number(req.params.id));
  const day = new Date().toISOString().slice(0, 10);
  if (req.params.what === "transactions.csv") {
    return sendCsv(res, `${safeName(p.name)}-transactions-${day}.csv`, csv([["date", "symbol", "type", "quantity", "price", "commission", "other_charges", "tax", "notes"], ...txsFor(p.id).map((t) => [t.date, t.symbol, t.type, t.quantity, t.price, t.commission, t.otherCharges, t.tax, t.notes])]));
  }
  if (req.params.what === "holdings.csv") {
    const d = portfolioSummary(p.id);
    return sendCsv(res, `${safeName(p.name)}-holdings-${day}.csv`, csv([["symbol", "sector", "quantity", "wacc", "cost_basis", "last_price", "market_value", "unrealized_pnl", "unrealized_pct", "realized_pnl", "dividends_net", "price_date"],
      ...d.summary.holdings.map((h) => [h.symbol, d.sectors[h.symbol] ?? "", h.quantity, h.wacc.toFixed(2), h.costBasis.toFixed(2), h.lastPrice, h.marketValue?.toFixed(2), h.unrealizedPnl?.toFixed(2), h.unrealizedPct?.toFixed(2), h.realizedPnl.toFixed(2), h.dividendsReceived.toFixed(2), d.priceDate])]));
  }
  if (req.params.what === "tax.csv") {
    const t = taxReport(p.id, getSetting("fyStart", "07-16"));
    return sendCsv(res, `${safeName(p.name)}-tax-${day}.csv`, csv([["fiscal_year", "date", "kind", "symbol", "quantity", "proceeds_or_gross", "cost_basis", "gain", "holding_days", "tax", "tax_estimated"],
      ...t.sells.map((e) => [e.fy, e.date, "sale", e.symbol, e.qty, e.proceeds.toFixed(2), e.costBasis.toFixed(2), e.gain.toFixed(2), e.holdingDays, e.tax.toFixed(2), e.taxEstimated ? "yes" : "no"]),
      ...t.dividends.map((e) => [e.fy, e.date, "cash dividend", e.symbol, "", e.gross.toFixed(2), "", "", "", e.tax.toFixed(2), ""])]));
  }
  res.status(404).json({ error: "Unknown export" });
});

// ---------- saved screens (per user) ----------
const screenSchema = z.array(z.object({ name: z.string().trim().min(1).max(60), sector: z.string().max(80).default(""), q: z.string().max(60).default(""), filters: z.record(z.union([z.string().max(20), z.boolean()])) })).max(50);
portfolioRouter.get("/screens", (req, res) => res.json(getSetting(`screens:${uid(req)}`, [])));
portfolioRouter.put("/screens", (req, res) => { setSetting(`screens:${uid(req)}`, screenSchema.parse(req.body)); res.json({ ok: true }); });
