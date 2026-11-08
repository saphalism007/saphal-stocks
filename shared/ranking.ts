// Strategy-specific stock ranking. Each strategy has its own transparent
// weights and eligibility filters (a great 5-year investment can be a terrible
// 2-week trade, so investing and trading models are separate). Users can
// override weights from the UI.

export interface StockFactors {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  asOf: string | null;
  avgTurnover20: number | null; // Rs.
  fundamentalScore: number | null;
  profitabilityScore: number | null;
  valuationScore: number | null;
  healthScore: number | null;
  dividendScore: number | null;
  growthScore: number | null;
  technicalScore: number | null;
  roe: number | null;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  cashYield: number | null;
  yearsPaid5: number | null;
  profitGrowthYoY: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
  rsi: number | null;
  adx: number | null;
  trend: string | null;
  atrPct: number | null;
  volatility: number | null; // annualised %, from daily returns
  distFrom52wHighPct: number | null;
  setupQuality: number | null; // best active setup
  setupType: string | null;
  redFlags: number;
}

export type StrategyKey =
  | "quality" | "value" | "dividend" | "growth" | "momentum" | "swing" | "longterm" | "riskadjusted" | "avoid" | "deteriorating";

export interface FactorWeight { factor: keyof StockFactors | string; weight: number; label: string; higherIsBetter: boolean; lo: number; hi: number }

export interface RankStrategy {
  key: StrategyKey;
  name: string;
  horizon: string;
  kind: "investing" | "trading" | "risk";
  description: string;
  weights: FactorWeight[];
  filters: { label: string; test: (f: StockFactors) => boolean }[];
}

const liquid = { label: "Average daily turnover >= Rs. 50 lakh (tradable)", test: (f: StockFactors) => (f.avgTurnover20 ?? 0) >= 5_000_000 };
const hasFund = { label: "Has fundamental data", test: (f: StockFactors) => f.fundamentalScore != null };
const profitable = { label: "Positive earnings", test: (f: StockFactors) => (f.eps ?? 0) > 0 };

export const RANK_STRATEGIES: RankStrategy[] = [
  {
    key: "quality", name: "Fundamentally strong", horizon: "1-5 years", kind: "investing",
    description: "High profitability, sound balance sheet and asset quality for the sector, consistent dividends. Valuation matters less.",
    weights: [
      { factor: "profitabilityScore", weight: 0.35, label: "Profitability", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "healthScore", weight: 0.35, label: "Financial health / asset quality", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "dividendScore", weight: 0.15, label: "Dividend record", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "valuationScore", weight: 0.15, label: "Valuation", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [hasFund, profitable],
  },
  {
    key: "value", name: "Undervalued", horizon: "1-3 years", kind: "investing",
    description: "Cheap on P/E and P/B relative to the market, but only among profitable companies with acceptable health (to avoid value traps).",
    weights: [
      { factor: "valuationScore", weight: 0.5, label: "Valuation (sector-aware P/E, P/B)", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "healthScore", weight: 0.25, label: "Financial health", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "profitabilityScore", weight: 0.25, label: "Profitability", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [hasFund, profitable, { label: "No more than 1 red flag", test: (f) => f.redFlags <= 1 }],
  },
  {
    key: "dividend", name: "Dividend", horizon: "2+ years", kind: "investing",
    description: "Consistent dividend payers with a decent cash yield and earnings that can sustain payouts.",
    weights: [
      { factor: "yearsPaid5", weight: 0.35, label: "Years paid out of last 5", higherIsBetter: true, lo: 0, hi: 5 },
      { factor: "cashYield", weight: 0.35, label: "Cash dividend yield", higherIsBetter: true, lo: 0, hi: 6 },
      { factor: "profitabilityScore", weight: 0.2, label: "Profitability (sustainability)", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "healthScore", weight: 0.1, label: "Financial health", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [profitable, { label: "Paid a dividend in at least 3 of 5 years", test: (f) => (f.yearsPaid5 ?? 0) >= 3 }],
  },
  {
    key: "growth", name: "Growth", horizon: "1-3 years", kind: "investing",
    description: "Rising profits year-over-year with good returns on equity; valuation is a secondary check.",
    weights: [
      { factor: "profitGrowthYoY", weight: 0.45, label: "Net profit growth YoY", higherIsBetter: true, lo: -10, hi: 40 },
      { factor: "roe", weight: 0.3, label: "ROE", higherIsBetter: true, lo: 5, hi: 20 },
      { factor: "valuationScore", weight: 0.25, label: "Valuation", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [profitable, { label: "Has YoY profit growth data", test: (f) => f.profitGrowthYoY != null }],
  },
  {
    key: "momentum", name: "Momentum", horizon: "1-3 months", kind: "trading",
    description: "Strong 3- and 6-month price performance, price near 52-week highs, trend strength. Liquid stocks only.",
    weights: [
      { factor: "return3m", weight: 0.3, label: "3-month return", higherIsBetter: true, lo: -10, hi: 30 },
      { factor: "return6m", weight: 0.25, label: "6-month return", higherIsBetter: true, lo: -15, hi: 50 },
      { factor: "distFrom52wHighPct", weight: 0.2, label: "Closeness to 52-week high", higherIsBetter: true, lo: -40, hi: 0 },
      { factor: "technicalScore", weight: 0.25, label: "Technical score", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [liquid],
  },
  {
    key: "swing", name: "Swing trading", horizon: "1-4 weeks", kind: "trading",
    description: "Active, rule-based setups (breakout, pullback, momentum) with good risk/reward and volume. Fundamentals only as a minor filter.",
    weights: [
      { factor: "setupQuality", weight: 0.6, label: "Best setup quality", higherIsBetter: true, lo: 30, hi: 90 },
      { factor: "technicalScore", weight: 0.3, label: "Technical score", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "fundamentalScore", weight: 0.1, label: "Fundamental score", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [liquid, { label: "Has an active buy setup", test: (f) => f.setupQuality != null }],
  },
  {
    key: "longterm", name: "Long-term investment", horizon: "3-10 years", kind: "investing",
    description: "Blend of quality, reasonable valuation, dividends and long-term trend. Built for patient investors.",
    weights: [
      { factor: "fundamentalScore", weight: 0.45, label: "Fundamental score", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "valuationScore", weight: 0.25, label: "Valuation", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "dividendScore", weight: 0.15, label: "Dividends", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "return1y", weight: 0.15, label: "1-year trend", higherIsBetter: true, lo: -30, hi: 40 },
    ],
    filters: [hasFund, profitable, { label: "No more than 1 red flag", test: (f) => f.redFlags <= 1 }],
  },
  {
    key: "riskadjusted", name: "Best risk-adjusted", horizon: "6-24 months", kind: "investing",
    description: "Good fundamentals and positive trend with low volatility.",
    weights: [
      { factor: "fundamentalScore", weight: 0.35, label: "Fundamental score", higherIsBetter: true, lo: 0, hi: 100 },
      { factor: "volatility", weight: 0.35, label: "Annualised volatility (lower is better)", higherIsBetter: false, lo: 15, hi: 60 },
      { factor: "technicalScore", weight: 0.3, label: "Technical score", higherIsBetter: true, lo: 0, hi: 100 },
    ],
    filters: [hasFund, liquid],
  },
  {
    key: "avoid", name: "Stocks to avoid", horizon: "-", kind: "risk",
    description: "Ranks the weakest: red flags, losses, downtrends and poor fundamentals. Higher score = more reasons for caution.",
    weights: [
      { factor: "redFlags", weight: 0.35, label: "Number of red flags", higherIsBetter: true, lo: 0, hi: 3 },
      { factor: "fundamentalScore", weight: 0.35, label: "Fundamental score (lower is worse)", higherIsBetter: false, lo: 20, hi: 80 },
      { factor: "technicalScore", weight: 0.3, label: "Technical score (lower is worse)", higherIsBetter: false, lo: 20, hi: 70 },
    ],
    filters: [],
  },
  {
    key: "deteriorating", name: "Deteriorating fundamentals", horizon: "-", kind: "risk",
    description: "Falling profits year-over-year and weak profitability or health. Higher score = more deterioration.",
    weights: [
      { factor: "profitGrowthYoY", weight: 0.6, label: "Profit decline YoY", higherIsBetter: false, lo: -50, hi: 0 },
      { factor: "healthScore", weight: 0.4, label: "Financial health (lower is worse)", higherIsBetter: false, lo: 20, hi: 80 },
    ],
    filters: [{ label: "Profit fell year-over-year", test: (f) => (f.profitGrowthYoY ?? 0) < 0 }],
  },
];

export interface RankedRow { rank: number; symbol: string; name: string; sector: string; score: number; coverage: number; contributions: { label: string; raw: number | null; points: number }[]; factors: StockFactors }

export function rankStocks(rows: StockFactors[], strategy: RankStrategy, overrideWeights?: Record<string, number>, limit = 50): { ranked: RankedRow[]; excluded: number } {
  const weights = strategy.weights.map((w) => ({ ...w, weight: overrideWeights?.[w.factor as string] ?? w.weight }));
  const total = weights.reduce((s, w) => s + w.weight, 0) || 1;
  const eligible = rows.filter((r) => strategy.filters.every((f) => f.test(r)));
  const ranked: RankedRow[] = [];
  for (const r of eligible) {
    let pts = 0;
    let covered = 0;
    const contributions: RankedRow["contributions"] = [];
    for (const w of weights) {
      const raw = (r as unknown as Record<string, number | null>)[w.factor as string];
      if (raw == null || !Number.isFinite(raw)) { contributions.push({ label: w.label, raw: null, points: 0 }); continue; }
      let t = (raw - w.lo) / (w.hi - w.lo);
      t = Math.max(0, Math.min(1, t));
      if (!w.higherIsBetter) t = 1 - t;
      const p = (t * 100 * w.weight) / total;
      pts += p;
      covered += w.weight;
      contributions.push({ label: w.label, raw: Math.round(raw * 100) / 100, points: Math.round(p * 10) / 10 });
    }
    const coverage = covered / total;
    if (coverage < 0.5) continue; // too little data to rank fairly
    // Rescale to the covered weight so missing factors don't silently count as zero.
    ranked.push({ rank: 0, symbol: r.symbol, name: r.name, sector: r.sector, score: Math.round(pts / coverage), coverage: Math.round(coverage * 100), contributions, factors: r });
  }
  ranked.sort((a, b) => b.score - a.score || b.coverage - a.coverage);
  ranked.forEach((r, i) => (r.rank = i + 1));
  return { ranked: ranked.slice(0, limit), excluded: rows.length - ranked.length };
}

export function annualisedVolatility(closes: number[], sessions = 120): number | null {
  const c = closes.slice(-sessions - 1);
  if (c.length < 30) return null;
  const rets: number[] = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) rets.push(Math.log(c[i] / c[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.round(Math.sqrt(v) * Math.sqrt(240) * 1000) / 10; // ~240 NEPSE sessions/year
}
