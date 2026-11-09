// Market Mood scoring, the stock scorecard, expected price ranges, XIRR and the stock basket rules. Pure; tested.
import type { StockFactors } from "./ranking.ts";

export interface MoodInputs { advancePct: number | null; above50Pct: number | null; highsPct: number | null; momentumPct: number | null; turnoverRatio: number | null; rsi: number | null }
const clamp = (x: number) => Math.max(0, Math.min(100, x));
const lin = (x: number, lo: number, hi: number) => clamp(((x - lo) / (hi - lo)) * 100);

/** NEPSE mood 0–100 (0 extreme fear, 100 extreme greed): the average of six market readings, each scaled 0–100. */
export function moodScore(m: MoodInputs) {
  const parts = [
    { key: "breadth", label: "Rising vs falling stocks (10 days)", value: m.advancePct, score: m.advancePct == null ? null : lin(m.advancePct, 30, 70) },
    { key: "trend", label: "Stocks above their 50-day average", value: m.above50Pct, score: m.above50Pct },
    { key: "highs", label: "52-week highs vs lows", value: m.highsPct, score: m.highsPct },
    { key: "momentum", label: "NEPSE vs its 125-day average", value: m.momentumPct, score: m.momentumPct == null ? null : lin(m.momentumPct, -10, 10) },
    { key: "volume", label: "Turnover vs 3-month average", value: m.turnoverRatio, score: m.turnoverRatio == null ? null : lin(m.turnoverRatio, 0.5, 1.5) },
    { key: "rsi", label: "NEPSE RSI (14)", value: m.rsi, score: m.rsi },
  ].map((p) => ({ ...p, value: p.value == null ? null : Math.round(p.value * 100) / 100, score: p.score == null ? null : Math.round(p.score) }));
  const got = parts.filter((p) => p.score != null);
  const score = got.length ? Math.round(got.reduce((s, p) => s + (p.score as number), 0) / got.length) : 50;
  return { score, parts };
}
export const moodLabel = (s: number) => (s < 25 ? "Extreme fear" : s < 45 ? "Fear" : s <= 55 ? "Neutral" : s <= 75 ? "Greed" : "Extreme greed");
export const moodAdvice = (s: number) => s < 25 ? "Most investors are scared. Historically, extreme fear is when patient long-term buyers find good prices — buy slowly, only strong companies."
  : s < 45 ? "The market is cautious. Good time to build positions gradually in quality stocks; keep stops."
  : s <= 55 ? "No strong emotion either way. Follow your plan and the individual stock signals."
  : s <= 75 ? "Optimism is high. Avoid chasing; take partial profits on big winners and tighten stops."
  : "Euphoria. Risk of a sharp fall is high: don't buy on tips, book profits, keep cash ready.";

/** Six-axis scorecard (0–100 each) like a "snowflake". */
export function scorecard(f: Pick<StockFactors, "valuationScore" | "growthScore" | "profitabilityScore" | "healthScore" | "dividendScore" | "technicalScore">) {
  return [
    { key: "value", label: "Value", score: f.valuationScore },
    { key: "growth", label: "Growth", score: f.growthScore },
    { key: "profit", label: "Profitability", score: f.profitabilityScore },
    { key: "health", label: "Financial health", score: f.healthScore },
    { key: "dividend", label: "Dividends", score: f.dividendScore },
    { key: "momentum", label: "Momentum", score: f.technicalScore },
  ].map((a) => ({ ...a, score: a.score == null ? null : Math.round(a.score) }));
}

/** Likely price range from recent volatility (about 2-in-3 and 19-in-20 chances), for 1 week and 1 month. */
export function expectedRange(price: number, closes: number[], days = 60) {
  const c = closes.slice(-(days + 1));
  if (c.length < 20 || price <= 0) return null;
  const r: number[] = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1));
  const band = (n: number, z: number) => ({ low: Math.round(price * Math.exp(-z * sd * Math.sqrt(n)) * 100) / 100, high: Math.round(price * Math.exp(z * sd * Math.sqrt(n)) * 100) / 100 });
  return { dailyVolPct: Math.round(sd * 10000) / 100, week: { likely: band(5, 1), wide: band(5, 2) }, month: { likely: band(21, 1), wide: band(21, 2) } };
}

/** Money-weighted yearly return (XIRR) of dated cash flows: money in is negative, money out (and today's value) positive. */
export function xirr(flows: { date: string; amount: number }[]) {
  const fs = flows.filter((f) => f.amount !== 0).sort((a, b) => a.date.localeCompare(b.date));
  if (fs.length < 2 || !fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(fs[0].date);
  const npv = (r: number) => fs.reduce((s, f) => s + f.amount / Math.pow(1 + r, (Date.parse(f.date) - t0) / (365.25 * 86_400_000)), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

/** Ready-made baskets: transparent rules over the stock factors (liquid stocks only). */
export interface BasketDef { key: string; name: string; idea: string; who: string; risk: "Low" | "Medium" | "High"; pick: (f: StockFactors[]) => StockFactors[] }
const liquid = (f: StockFactors[]) => f.filter((x) => (x.avgTurnover20 ?? 0) >= 1_000_000 && x.price != null && x.redFlags < 3);
const top = (xs: StockFactors[], key: (x: StockFactors) => number | null, n = 10) => xs.filter((x) => key(x) != null).sort((a, b) => (key(b) as number) - (key(a) as number)).slice(0, n);
export const BASKETS: BasketDef[] = [
  { key: "quality", name: "Quality compounders", idea: "Highly profitable, healthy companies with growing earnings.", who: "Long-term investors (5+ years)", risk: "Medium", pick: (f) => top(liquid(f).filter((x) => (x.profitabilityScore ?? 0) >= 60 && (x.healthScore ?? 0) >= 50), (x) => (x.fundamentalScore ?? 0) + (x.growthScore ?? 0) / 2) },
  { key: "dividend", name: "Steady dividend payers", idea: "Paid cash dividends in at least 4 of the last 5 years, highest yields first.", who: "Income seekers", risk: "Low", pick: (f) => top(liquid(f).filter((x) => (x.yearsPaid5 ?? 0) >= 4 && (x.cashYield ?? 0) > 0), (x) => x.cashYield) },
  { key: "value", name: "Value picks", idea: "Cheapest on earnings and book value among companies with decent fundamentals.", who: "Patient investors", risk: "Medium", pick: (f) => top(liquid(f).filter((x) => (x.fundamentalScore ?? 0) >= 50 && x.pe != null && x.pe > 0), (x) => x.valuationScore) },
  { key: "momentum", name: "Momentum leaders", idea: "Strongest price trends and technical scores right now.", who: "Swing traders (weeks to months)", risk: "High", pick: (f) => top(liquid(f).filter((x) => x.trend === "uptrend"), (x) => (x.technicalScore ?? 0) + (x.return3m ?? 0) / 2) },
  { key: "banks", name: "Strong banks", idea: "Commercial banks with the best fundamentals: the core of NEPSE.", who: "Beginners and conservative investors", risk: "Low", pick: (f) => top(liquid(f).filter((x) => /Commercial Bank/i.test(x.sector)), (x) => x.fundamentalScore, 8) },
  { key: "hydro", name: "Hydropower leaders", idea: "Hydropower companies with the best mix of fundamentals and trend.", who: "Higher-risk, long-term investors", risk: "High", pick: (f) => top(liquid(f).filter((x) => /Hydro/i.test(x.sector)), (x) => (x.fundamentalScore ?? 0) + (x.technicalScore ?? 0), 8) },
  { key: "lowvol", name: "Low-volatility shares", idea: "Liquid stocks whose prices swing the least, with positive fundamentals.", who: "Cautious investors", risk: "Low", pick: (f) => top(liquid(f).filter((x) => x.volatility != null && (x.fundamentalScore ?? 0) >= 45), (x) => -(x.volatility as number)) },
  { key: "growth", name: "Fast growers", idea: "Profits growing fastest year on year, with acceptable health.", who: "Growth investors", risk: "High", pick: (f) => top(liquid(f).filter((x) => (x.healthScore ?? 0) >= 40 && (x.profitabilityScore ?? 0) >= 40 && (x.profitGrowthYoY ?? 0) > 0), (x) => x.profitGrowthYoY) },
];
