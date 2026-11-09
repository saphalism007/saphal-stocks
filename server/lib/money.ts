// Personal money service: combines your money data (encrypted vault) with official rates
// (NRB), your verified deposit rates and your Portfolio, and runs the deterministic engines
// in shared/money.ts. Used by the routes, the briefing and the AI analyst.
import { all, get, getSetting } from "../db.ts";
import { readVault, writeVault } from "./vault.ts";
import { txsFor, latestPrices } from "./portfolioService.ts";
import { computeHoldings } from "../../shared/portfolio.ts";
import * as MO from "../../shared/money.ts";
import * as M from "./market.ts";

export interface RateRow { key: string; grp: string; label: string; value: number; as_of: string; prev_value: number | null; prev_as_of: string | null; source_url: string }
// Older market snapshots on a device may not have the rates tables yet: treat as unavailable.
const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
const rate = (key: string) => safe(() => get<RateRow>("SELECT * FROM rates WHERE key = ?", key) ?? null, null);

export function macroLatest() {
  const m = safe(() => get<{ url: string; pdf_url: string; title: string; published: string; inflation: number | null; highlights: string }>("SELECT * FROM macro_reports ORDER BY published DESC LIMIT 1"), undefined);
  return m ? { ...m, highlights: JSON.parse(m.highlights || "[]") as string[] } : null;
}

/** NEPSE long-run return used by the advisor: 10-year index growth (price) plus the market's median cash dividend yield.
 *  The full stored history is shown for reference only; it starts at a 2012 low and would overstate returns. */
export function nepseLongRun() {
  return safe(() => {
    const last = get<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND close > 0 ORDER BY date DESC LIMIT 1");
    const first = get<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND close > 0 ORDER BY date LIMIT 1");
    if (!last || !first) return null;
    const tenAgo = new Date(Date.parse(last.date) - 3652 * 86_400_000).toISOString().slice(0, 10);
    const base = get<{ date: string; close: number }>("SELECT date, close FROM indices WHERE index_id = 12 AND close > 0 AND date <= ? ORDER BY date DESC LIMIT 1", tenAgo) ?? first;
    const years = (Date.parse(last.date) - Date.parse(base.date)) / (365.25 * 86_400_000);
    if (years < 3) return null;
    const price = MO.cagr(base.close, last.close, years);
    const fullYears = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86_400_000);
    const full = MO.cagr(first.close, last.close, fullYears);
    // Market-cap weighted cash dividend yield (like the index itself); bonus shares are already in the index level.
    // Latest cash dividend % of face value (Rs. 100, or the listed paid-up value) over the latest price, per company.
    const rows = all<{ cash_pct: number; face: number | null; shares: number | null; close: number | null }>(`
      SELECT d.cash_pct, c.paid_up_value face, c.listed_shares shares, (SELECT close FROM prices p WHERE p.symbol = c.symbol ORDER BY date DESC LIMIT 1) close
      FROM companies c JOIN dividends d ON d.symbol = c.symbol AND d.fiscal_year = (SELECT MAX(fiscal_year) FROM dividends x WHERE x.symbol = c.symbol)
      WHERE c.sector NOT IN ('Mutual Fund', 'Corporate Debentures', 'Promoter Share')`);
    let wSum = 0, ySum = 0;
    for (const r of rows) {
      if (!r.close || !r.shares || r.cash_pct == null) continue;
      const y = (r.cash_pct / 100) * (r.face || 100) / r.close * 100;
      if (y < 0 || y > 30) continue;
      const cap = r.close * r.shares;
      wSum += cap; ySum += cap * y;
    }
    const div = wSum > 0 ? ySum / wSum : null;
    if (price == null) return null;
    const total = price + (div ?? 0);
    return { pct: Math.round(total * 10) / 10, pricePct: Math.round(price * 10) / 10, dividendYieldPct: div != null ? Math.round(div * 10) / 10 : null, fullHistoryPct: full != null ? Math.round(full * 10) / 10 : null, from: base.date, to: last.date, fromValue: base.close, toValue: last.close, years: Math.round(years * 10) / 10, fullFrom: first.date };
  }, null);
}

export const interestTaxPct = () => getSetting<number>("interest_tax_pct", 6);

export interface DepositRateRow { id: number; institution: string; inst_type: string | null; product: string | null; depositor: string; tenor_months: number | null; rate: number; effective_from: string | null; source_url: string | null; method: string; verified_on: string | null; notes: string | null }
export const depositRates = () => safe(() => all<DepositRateRow>("SELECT * FROM deposit_rates ORDER BY rate DESC"), [] as DepositRateRow[]);

/** The rates the advisor uses, each with where it came from. */
export function marketRates(): MO.MarketRates & { sources: Record<string, string> } {
  const sources: Record<string, string> = {};
  const recent = depositRates().filter((d) => d.depositor !== "institutional" && (d.tenor_months == null || (d.tenor_months >= 6 && d.tenor_months <= 24)) && (!d.effective_from || Date.now() - Date.parse(d.effective_from) < 75 * 86_400_000));
  const nrbFd = rate("deposit.fixed_deposit");
  let fdPct: number | null = null;
  if (recent.length) { fdPct = recent[0].rate; sources.fd = `${recent[0].institution} ${recent[0].product ?? "fixed deposit"} (${recent[0].method === "ai" ? "read from its notice by AI" : "entered by you"}${recent[0].effective_from ? `, from ${recent[0].effective_from}` : ""})`; }
  else if (nrbFd) { fdPct = nrbFd.value; sources.fd = `NRB weighted average FD rate, ${nrbFd.as_of} (best offers are usually higher; add verified rates under Deposit rates)`; }
  const sav = rate("deposit.saving_deposit");
  if (sav) sources.saving = `NRB average savings rate, ${sav.as_of}`;
  const tb = rate("tbill.364_days");
  if (tb) sources.tbill = `NRB 364-day T-bill, ${tb.as_of}`;
  const mac = macroLatest();
  if (mac?.inflation != null) sources.inflation = `NRB CPI inflation (${mac.title}), published ${mac.published}`;
  const eq = nepseLongRun();
  if (eq) sources.equity = `NEPSE index ${eq.from} to ${eq.to} (${eq.fromValue} to ${eq.toValue}): ${eq.pricePct}% a year in price${eq.dividendYieldPct != null ? ` + ${eq.dividendYieldPct}% cash dividend yield (market-cap weighted)` : ""}. Not guaranteed; since ${eq.fullFrom.slice(0, 4)} it was ${eq.fullHistoryPct}% a year, over other periods negative`;
  return { fdPct, savingPct: sav?.value ?? null, tbillPct: tb?.value ?? null, inflationPct: mac?.inflation ?? null, equityLongRunPct: eq?.pct ?? null, interestTaxPct: interestTaxPct(), sources };
}

export function moneyData(userId: number): { id: number | null; data: MO.MoneyData } {
  const v = readVault<MO.MoneyData>(userId, "money")[0];
  if (v) return { id: v.id, data: { ...MO.EMPTY_MONEY, ...v.data } };
  // First time: start from the simpler financial profile if you filled one in.
  const p = readVault<Record<string, string>>(userId, "profile")[0]?.data;
  const n = (k: string) => Number(p?.[k]) || 0;
  const d: MO.MoneyData = { ...MO.EMPTY_MONEY };
  if (p) {
    if (n("monthlyIncome")) d.income.push({ id: "salary", label: "Salary / main income", amount: n("monthlyIncome") });
    if (n("additionalIncome")) d.income.push({ id: "other", label: "Other income", amount: n("additionalIncome") });
    if (n("monthlyExpenses")) d.expenses.push({ id: "living", label: "Living expenses", amount: n("monthlyExpenses"), essential: true, category: "other" });
    if (n("emergencyFund")) d.accounts.push({ id: "ef", name: "Emergency savings", type: "bank", balance: n("emergencyFund") });
    if (n("highInterestDebt")) d.liabilities.push({ id: "debt", name: "High-interest debt", type: "personal", balance: n("highInterestDebt"), ratePct: 14, emi: n("loanEmi") });
    d.risk = (p.risk as MO.Risk) || "medium";
    d.horizonYears = n("horizon") || 5;
  }
  return { id: null, data: d };
}
export function saveMoney(userId: number, data: MO.MoneyData) {
  const cur = readVault(userId, "money")[0];
  return writeVault(userId, "money", data, cur?.id);
}

export function portfolioValue(userId: number) {
  let v = 0;
  for (const p of all<{ id: number }>("SELECT id FROM portfolios WHERE user_id = ? AND kind = 'real'", userId)) {
    // Market value only (fast): holdings at the latest prices, without the full health analysis.
    const txs = txsFor(p.id);
    if (!txs.length) continue;
    v += computeHoldings(txs, latestPrices([...new Set(txs.map((t) => t.symbol))]), M.fees()).marketValue || 0;
  }
  return Math.round(v);
}

export function goalsSoon(userId: number) {
  return readVault<{ name?: string; costToday?: number; years?: number; currentSaved?: number }>(userId, "goal").map((g) => g.data).filter((g) => g.costToday && g.years != null)
    .map((g) => ({ name: g.name || "Goal", amount: Math.max(0, (g.costToday || 0) - (g.currentSaved || 0)), years: Number(g.years) }));
}

export function moneyOverview(userId: number) {
  const { data, id } = moneyData(userId);
  const pv = portfolioValue(userId);
  const summary = MO.summarize(data, { portfolioValue: pv });
  const rates = marketRates();
  const advice = MO.savingsAdvice(data, summary, rates);
  return { saved: id != null, data, summary, advice, rates, portfolioValue: pv, goals: goalsSoon(userId) };
}

export function allocate(userId: number, p: { amount: number; monthly?: number; risk?: MO.Risk; horizonYears?: number; keepEmergency?: boolean }) {
  const o = moneyOverview(userId);
  const fdNet = (o.rates.fdPct ?? 0) * (1 - o.rates.interestTaxPct / 100);
  const expensive = o.data.liabilities.filter((l) => l.balance > 0 && (l.type === "credit_card" || l.ratePct >= Math.max(11, fdNet + 6))).map((l) => ({ name: l.name, balance: l.balance, ratePct: l.ratePct }));
  const res = MO.adviseAllocation({
    amount: p.amount, monthly: p.monthly, risk: p.risk ?? o.data.risk, horizonYears: p.horizonYears ?? o.data.horizonYears,
    emergencyGap: p.keepEmergency === false ? 0 : o.summary.emergencyGap, expensiveDebt: expensive,
    nearTermNeeds: o.goals.filter((g) => g.years <= 3 && g.amount > 0), existingEquityPct: o.summary.equityPct, rates: o.rates,
  });
  return { ...res, rates: o.rates, inputs: { risk: p.risk ?? o.data.risk, horizonYears: p.horizonYears ?? o.data.horizonYears, emergencyGap: o.summary.emergencyGap, expensiveDebt: expensive, equityPct: o.summary.equityPct } };
}

export function compareDepositsFor(amount: number, months: number) {
  const r = marketRates();
  const offers = depositRates().filter((d) => d.depositor !== "institutional").map((d) => ({ institution: d.institution, instType: d.inst_type, product: d.product, tenorMonths: d.tenor_months, ratePct: d.rate, sourceUrl: d.source_url, effectiveFrom: d.effective_from, method: d.method }));
  const nrb = rate("deposit.fixed_deposit");
  if (nrb) offers.push({ institution: "NRB average (all commercial banks)", instType: "benchmark", product: "Weighted average FD rate", tenorMonths: null, ratePct: nrb.value, sourceUrl: nrb.source_url, effectiveFrom: nrb.as_of, method: "official" });
  return { amount, months, taxPct: r.interestTaxPct, inflationPct: r.inflationPct, rows: MO.compareDeposits(offers, amount, months, r.interestTaxPct, r.inflationPct) };
}
