import { Router } from "express";
import { z } from "zod";
import { all, get, run } from "../db.ts";
import { readVault, writeVault, deleteVault, type VaultKind } from "../lib/vault.ts";
import * as PL from "../../shared/planner.ts";
import { roundTrip, cgtRate } from "../../shared/costs.ts";
import { positionSize } from "../../shared/portfolio.ts";
import { dcf, dividendDiscount, grahamNumber } from "../../shared/fundamentals.ts";
import { fees } from "../lib/market.ts";

export const wealthRouter = Router();
const KINDS = ["profile", "goal", "networth", "journal", "thesis"] as const;
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
