import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.ts";
import { readVault, writeVault, deleteVault, type VaultKind } from "../lib/vault.ts";
import * as PL from "../../shared/planner.ts";
import { roundTrip, cgtRate } from "../../shared/costs.ts";
import { positionSize } from "../../shared/portfolio.ts";
import { dcf, dividendDiscount, grahamNumber } from "../../shared/fundamentals.ts";
import { fees } from "../lib/market.ts";
import * as MON from "../lib/money.ts";
import * as MO from "../../shared/money.ts";
import { extractNoticeRates } from "../ai/extract.ts";
import { nowIso } from "../db.ts";

export const wealthRouter = Router();
const KINDS = ["profile", "goal", "networth", "journal", "thesis", "money"] as const;
const json = z.record(z.unknown()).refine((o) => JSON.stringify(o).length < 200_000, "Too large");

wealthRouter.get("/vault/:kind", (req, res) => {
  const kind = z.enum(KINDS).parse(req.params.kind);
  res.json(readVault(req.userId!, kind as VaultKind));
});
wealthRouter.post("/vault/:kind", (req, res) => {
  const kind = z.enum(KINDS).parse(req.params.kind);
  res.json({ id: writeVault(req.userId!, kind, json.parse(req.body)) });
});
wealthRouter.put("/vault/:kind/:id", (req, res) => {
  const kind = z.enum(KINDS).parse(req.params.kind);
  res.json({ id: writeVault(req.userId!, kind, json.parse(req.body), Number(req.params.id)) });
});
wealthRouter.delete("/vault/:kind/:id", (req, res) => {
  deleteVault(req.userId!, z.enum(KINDS).parse(req.params.kind), Number(req.params.id));
  res.json({ ok: true });
});

const n = z.coerce.number();
wealthRouter.post("/calc/:kind", (req, res) => {
  const b = req.body as Record<string, unknown>;
  const F = fees();
  switch (req.params.kind) {
    case "emi": { const p = z.object({ principal: n.positive(), ratePct: n.min(0).max(50), months: n.int().positive().max(600) }).parse(b); return res.json(PL.emi(p.principal, p.ratePct, p.months)); }
    case "sip": { const p = z.object({ lump: n.min(0).default(0), monthly: n.min(0), returnPct: n.min(-20).max(50), months: n.int().positive().max(720), stepUpPct: n.min(0).max(50).default(0) }).parse(b); return res.json(PL.futureValue(p.lump, p.monthly, p.returnPct, p.months, p.stepUpPct)); }
    case "fd": { const p = z.object({ principal: n.positive(), ratePct: n.min(0).max(30), years: n.positive().max(30), compounding: n.int().positive().max(12).default(4), taxPct: n.min(0).max(40).default(6) }).parse(b); return res.json(PL.fdMaturity(p.principal, p.ratePct, p.years, p.compounding, p.taxPct)); }
    case "inflation": { const p = z.object({ amount: n.positive(), inflationPct: n.min(-10).max(50), years: n.min(0).max(100) }).parse(b); return res.json({ future: PL.inflate(p.amount, p.inflationPct, p.years), purchasingPowerOfToday: p.amount / Math.pow(1 + p.inflationPct / 100, p.years) }); }
    case "goal": { const p = z.object({ name: z.string().default("Goal"), costToday: n.positive(), years: n.positive().max(60), inflationPct: n.min(0).max(30), currentSaved: n.min(0), monthlyCapacity: n.min(0), annualStepUpPct: n.min(0).max(50).default(0), investmentCostPct: n.min(0).max(10).default(0), taxOnGainsPct: n.min(0).max(50).default(0) }).parse(b); return res.json(PL.planGoal(p)); }
    case "car": { const p = z.object({ price: n.positive(), downPaymentPct: n.min(0).max(100), loanRatePct: n.min(0).max(30), loanYears: n.int().positive().max(10), savingsReturnPct: n.min(0).max(30), carInflationPct: n.min(0).max(30), monthlyCapacity: n.min(0), currentSaved: n.min(0), maxLtvPct: n.min(0).max(100).optional() }).parse(b); return res.json(PL.carPlan(p)); }
    case "emergency": { const p = z.object({ monthlyExpenses: n.positive(), months: n.int().min(1).max(24).default(6), current: n.min(0).default(0) }).parse(b); return res.json(PL.emergencyFund(p.monthlyExpenses, p.months, p.current)); }
    case "fi": { const p = z.object({ annualExpenses: n.positive(), withdrawalRatePct: n.min(1).max(10).default(4), current: n.min(0).default(0), monthly: n.min(0).default(0), returnPct: n.default(10), inflationPct: n.default(6) }).parse(b); return res.json(PL.financialIndependence(p.annualExpenses, p.withdrawalRatePct, p.current, p.monthly, p.returnPct, p.inflationPct)); }
    case "allocation": { const p = z.object({ amount: n.positive(), emergencyFundGap: n.min(0), highInterestDebt: n.min(0), horizonYears: n.min(0).max(60), risk: z.enum(["low", "medium", "high"]), nearTermGoalAmount: n.min(0).default(0), nearTermGoalYears: n.min(0).default(10) }).parse(b); return res.json(PL.allocateLumpSum(p)); }
    case "position": { const p = z.object({ capital: n.positive(), riskPct: n.positive().max(20), entry: n.positive(), stop: n.positive() }).parse(b); return res.json(positionSize(p.capital, p.riskPct, p.entry, p.stop, F) ?? { error: "Stop must be below entry." }); }
    case "roundtrip": { const p = z.object({ qty: n.int().positive(), buyPrice: n.positive(), sellPrice: n.positive(), holdingDays: n.int().min(0) }).parse(b); return res.json({ ...roundTrip(p.qty, p.buyPrice, p.sellPrice, p.holdingDays, F), cgtRate: cgtRate(p.holdingDays, "individual", F) }); }
    case "dcf": { const p = z.object({ cashFlow0: n, growthYears: n.int().min(1).max(20), growthRate: n, terminalGrowth: n, discountRate: n }).parse(b); return res.json(dcf(p) ?? { error: "Discount rate must exceed terminal growth." }); }
    case "ddm": { const p = z.object({ dividend: n.min(0), growth: n, requiredReturn: n }).parse(b); return res.json({ value: dividendDiscount(p.dividend, p.growth, p.requiredReturn) }); }
    case "graham": { const p = z.object({ eps: n, bvps: n }).parse(b); return res.json({ value: grahamNumber(p.eps, p.bvps) }); }
  }
  res.status(404).json({ error: "Unknown calculator" });
});

// ---------- my money: cash flow, net worth, advice, allocation ----------
const line = z.object({ id: z.string().max(40), label: z.string().max(120), amount: n.min(0).max(1e10), essential: z.boolean().optional(), category: z.string().max(40).optional() });
const moneyBody = z.object({
  income: z.array(line).max(50), expenses: z.array(line).max(100),
  accounts: z.array(z.object({ id: z.string().max(40), name: z.string().max(120), type: z.enum(Object.keys(MO.CLASS) as [MO.AccountType, ...MO.AccountType[]]), institution: z.string().max(120).optional(), balance: n.min(0).max(1e11), ratePct: n.min(0).max(50).nullable().optional(), maturity: z.string().max(20).nullable().optional() })).max(100),
  liabilities: z.array(z.object({ id: z.string().max(40), name: z.string().max(120), type: z.enum(["home", "car", "personal", "education", "credit_card", "business", "family", "other"]), balance: n.min(0).max(1e11), ratePct: n.min(0).max(60), emi: n.min(0).max(1e9), monthsLeft: n.int().min(0).max(600).nullable().optional() })).max(50),
  risk: z.enum(["low", "medium", "high"]), horizonYears: n.min(0).max(60), emergencyMonths: n.int().min(1).max(24),
  savingsTarget: n.min(0).max(1e9).optional(),
  history: z.array(z.object({ month: z.string().max(7), netWorth: n, assets: n, liabilities: n })).max(600).optional(),
});
wealthRouter.get("/money", (req, res) => res.json(MON.moneyOverview(req.userId!)));
wealthRouter.put("/money", (req, res) => {
  const d = moneyBody.parse(req.body) as MO.MoneyData;
  // Record this month's net worth (one point per month, updated on each save).
  const s2 = MO.summarize(d, { portfolioValue: MON.portfolioValue(req.userId!) });
  const month = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 7);
  d.history = [...(d.history ?? []).filter((h) => h.month !== month), { month, netWorth: s2.netWorth, assets: s2.assets, liabilities: s2.liabilities }].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-240);
  MON.saveMoney(req.userId!, d);
  res.json(MON.moneyOverview(req.userId!));
});
wealthRouter.post("/money/debt-plan", (req, res) => {
  const p = z.object({ extra: n.min(0).max(1e9) }).parse(req.body);
  const d = MON.moneyData(req.userId!).data;
  res.json({ avalanche: MO.debtPlan(d.liabilities, p.extra, "avalanche"), snowball: MO.debtPlan(d.liabilities, p.extra, "snowball"), base: MO.debtPlan(d.liabilities, 0, "avalanche") });
});
wealthRouter.post("/money/compare-profiles", (req, res) => {
  const p = z.object({ amount: n.positive().max(1e11) }).parse(req.body);
  res.json({ amount: p.amount, profiles: MO.compareProfiles(p.amount, MON.marketRates()), rates: MON.marketRates() });
});
wealthRouter.post("/money/allocate", (req, res) => {
  const p = z.object({ amount: n.positive().max(1e11), monthly: n.min(0).max(1e9).optional(), risk: z.enum(["low", "medium", "high"]).optional(), horizonYears: n.min(0).max(60).optional(), keepEmergency: z.boolean().optional() }).parse(req.body);
  res.json(MON.allocate(req.userId!, p));
});
wealthRouter.post("/money/loan-vs-invest", (req, res) => {
  const p = z.object({ amount: n.positive(), loanRatePct: n.min(0).max(60), years: n.positive().max(40), investReturnPct: n.min(-20).max(50), investGuaranteed: z.boolean() }).parse(req.body);
  res.json(MO.loanVsInvest(p));
});
wealthRouter.get("/money/deposits/compare", (req, res) => {
  const amount = z.coerce.number().positive().max(1e11).parse(req.query.amount ?? 100000);
  const months = z.coerce.number().int().min(1).max(120).parse(req.query.months ?? 12);
  res.json(MON.compareDepositsFor(amount, months));
});
const depBody = z.object({ institution: z.string().min(2).max(160), inst_type: z.string().max(60).nullable().optional(), product: z.string().max(160).nullable().optional(), depositor: z.enum(["individual", "institutional", "remittance", "senior", "other"]).default("individual"), tenor_months: n.int().min(0).max(240).nullable().optional(), rate: n.positive().max(30), effective_from: z.string().max(20).nullable().optional(), source_url: z.string().url().max(600).nullable().optional().or(z.literal("")), notes: z.string().max(500).nullable().optional() });
wealthRouter.get("/money/deposit-rates", (_req, res) => res.json(MON.depositRates()));
wealthRouter.post("/money/deposit-rates", (req, res) => {
  const p = depBody.parse(req.body);
  const id = Number(run("INSERT INTO deposit_rates (institution, inst_type, product, depositor, tenor_months, rate, effective_from, source_url, method, verified_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)", p.institution, p.inst_type ?? null, p.product ?? null, p.depositor, p.tenor_months ?? null, p.rate, p.effective_from ?? null, p.source_url || null, nowIso().slice(0, 10), p.notes ?? null, nowIso()).lastInsertRowid);
  res.json({ id });
});
wealthRouter.put("/money/deposit-rates/:id/verify", (req, res) => { run("UPDATE deposit_rates SET method = 'verified', verified_on = ? WHERE id = ?", nowIso().slice(0, 10), Number(req.params.id)); res.json({ ok: true }); });
wealthRouter.delete("/money/deposit-rates/:id", (req, res) => { run("DELETE FROM deposit_rates WHERE id = ?", Number(req.params.id)); res.json({ ok: true }); });
wealthRouter.post("/money/deposit-rates/extract", async (req, res) => {
  const { url } = z.object({ url: z.string().url() }).parse(req.body);
  let notice: { url: string; institution: string; inst_type: string | null; image_url: string | null; published: string } | undefined;
  try { notice = get("SELECT * FROM rate_notices WHERE url = ?", url); } catch { /* older market snapshot */ }
  if (!notice?.image_url) return res.status(404).json({ error: "No notice image stored for this link." });
  const x = await extractNoticeRates(notice.image_url);
  run("DELETE FROM deposit_rates WHERE source_url = ? AND method = 'ai'", notice.url);
  for (const r of x.rates) run("INSERT INTO deposit_rates (institution, inst_type, product, depositor, tenor_months, rate, effective_from, source_url, method, verified_on, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL, ?, ?)", notice.institution, notice.inst_type, r.product, r.depositor, r.tenor_months, r.rate, x.effective_from ?? notice.published, notice.url, `Read by AI from the notice published ${notice.published}`, nowIso());
  res.json({ institution: notice.institution, effective_from: x.effective_from, saved: x.rates.length, rates: x.rates, saving_rate_max: x.saving_rate_max, base_rate: x.base_rate });
});

// ---------- income & expense tracker ----------
const entryBody = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.enum(["income", "expense"]), category: z.string().min(1).max(40), amount: n.positive().max(1e10), note: z.string().max(300).nullable().optional(), method: z.string().max(30).nullable().optional() });
const monthQ = (q: unknown) => z.string().regex(/^\d{4}-\d{2}$/).parse(q);
const monthsBack = (m: string, k: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 - k, 1)); return d.toISOString().slice(0, 7); };
wealthRouter.get("/money/entries", (req, res) => {
  const month = monthQ(req.query.month ?? new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 7));
  const rows = all<MO.Entry & { id: number }>("SELECT id, date, type, category, amount, note, method FROM money_entries WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC", month);
  const trend = Array.from({ length: 6 }, (_, i) => monthsBack(month, 5 - i)).map((m) => {
    const r = get<{ inc: number | null; exp: number | null; inv: number | null }>("SELECT SUM(CASE WHEN type='income' THEN amount END) inc, SUM(CASE WHEN type='expense' AND category <> 'invest' THEN amount END) exp, SUM(CASE WHEN type='expense' AND category = 'invest' THEN amount END) inv FROM money_entries WHERE substr(date,1,7) = ?", m);
    return { month: m, income: r?.inc ?? 0, spending: r?.exp ?? 0, invested: r?.inv ?? 0 };
  });
  const prev = MO.summarizeEntries(all<MO.Entry>("SELECT date, type, category, amount FROM money_entries WHERE substr(date, 1, 7) = ?", monthsBack(month, 1)));
  res.json({ month, entries: rows, summary: MO.summarizeEntries(rows), previous: { month: monthsBack(month, 1), spending: prev.spending, income: prev.income }, trend, count: get<{ n: number }>("SELECT COUNT(*) n FROM money_entries")?.n ?? 0 });
});
wealthRouter.post("/money/entries", (req, res) => {
  const e = entryBody.parse(req.body);
  res.json({ id: Number(run("INSERT INTO money_entries (date, type, category, amount, note, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", e.date, e.type, e.category, e.amount, e.note ?? null, e.method ?? null, nowIso()).lastInsertRowid) });
});
wealthRouter.put("/money/entries/:id", (req, res) => {
  const e = entryBody.parse(req.body);
  run("UPDATE money_entries SET date = ?, type = ?, category = ?, amount = ?, note = ?, method = ? WHERE id = ?", e.date, e.type, e.category, e.amount, e.note ?? null, e.method ?? null, Number(req.params.id));
  res.json({ ok: true });
});
wealthRouter.delete("/money/entries/:id", (req, res) => { run("DELETE FROM money_entries WHERE id = ?", Number(req.params.id)); res.json({ ok: true }); });
wealthRouter.get("/money/entries/averages", (_req, res) => {
  // The last three full months before this one.
  const cur = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 7);
  const months = [1, 2, 3].map((k) => monthsBack(cur, k)).filter((m) => (get<{ n: number }>("SELECT COUNT(*) n FROM money_entries WHERE substr(date,1,7) = ?", m)?.n ?? 0) > 0);
  const entries = all<MO.Entry>("SELECT date, type, category, amount FROM money_entries WHERE substr(date,1,7) IN (" + months.map(() => "?").join(",") + ")", ...months);
  const incomes = months.length ? entries.filter((e) => e.type === "income").reduce((s2, e) => s2 + e.amount, 0) / months.length : 0;
  res.json({ months, expenses: months.length ? MO.averageMonthly(entries, months) : [], income: Math.round(incomes) });
});
wealthRouter.get("/money/entries.csv", (_req, res) => {
  const rows = all<MO.Entry>("SELECT date, type, category, amount, note, method FROM money_entries ORDER BY date, id");
  const esc = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="saphal-income-expenses.csv"');
  res.send(["Date,Type,Category,Amount (NPR),Note,Paid with", ...rows.map((r) => [r.date, r.type, r.category, r.amount, r.note, r.method].map(esc).join(","))].join("\n"));
});

// ---------- investment products & resources ----------
wealthRouter.get("/products", (_req, res) => res.json(all("SELECT * FROM products ORDER BY category, name")));

const productBody = z.object({
  category: z.string().max(80), name: z.string().max(200), provider: z.string().max(200).nullable().optional(), description: z.string().max(4000).nullable().optional(),
  eligibility: z.string().max(2000).nullable().optional(), min_investment: z.string().max(500).nullable().optional(), return_text: z.string().max(1000).nullable().optional(),
  return_type: z.enum(["contractual", "variable", "historical", "projected", "unknown"]).nullable().optional(), risk: z.string().max(200).nullable().optional(),
  lock_in: z.string().max(500).nullable().optional(), duration: z.string().max(500).nullable().optional(), liquidity: z.string().max(500).nullable().optional(), tax: z.string().max(1000).nullable().optional(),
  conditions: z.string().max(2000).nullable().optional(), how_to_apply: z.string().max(2000).nullable().optional(), official_url: z.string().url().max(500).nullable().optional(),
  info_url: z.string().url().max(500).nullable().optional().or(z.literal("")), verified_on: z.string().max(40).nullable().optional(), source: z.string().max(500).nullable().optional(),
});
const PCOLS = ["category", "name", "provider", "description", "eligibility", "min_investment", "return_text", "return_type", "risk", "lock_in", "duration", "liquidity", "tax", "conditions", "how_to_apply", "official_url", "info_url", "verified_on", "source"] as const;

wealthRouter.post("/products", (req, res) => {
  const p = productBody.parse(req.body) as Record<string, unknown>;
  const id = Number(run(`INSERT INTO products (${PCOLS.join(",")}, user_edited) VALUES (${PCOLS.map(() => "?").join(",")}, 1)`, ...PCOLS.map((c) => p[c] ?? null)).lastInsertRowid);
  res.json({ id });
});
wealthRouter.put("/products/:id", (req, res) => {
  const p = productBody.partial().parse(req.body) as Record<string, unknown>;
  const cur = get<Record<string, unknown>>("SELECT * FROM products WHERE id = ?", Number(req.params.id));
  if (!cur) return res.status(404).json({ error: "Not found" });
  run(`UPDATE products SET ${PCOLS.map((c) => `${c} = ?`).join(", ")}, user_edited = 1 WHERE id = ?`, ...PCOLS.map((c) => (c in p ? p[c] : cur[c]) ?? null), cur.id);
  res.json({ ok: true });
});
wealthRouter.delete("/products/:id", (req, res) => { run("DELETE FROM products WHERE id = ? AND seed_key IS NULL", Number(req.params.id)); res.json({ ok: true }); });

wealthRouter.get("/resources", (_req, res) => res.json(all<Record<string, unknown>>("SELECT * FROM resources ORDER BY category, name").map((r) => ({ ...r, links: r.links ? JSON.parse(r.links as string) : [] }))));
