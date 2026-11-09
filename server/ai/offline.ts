// Deterministic analyst. Builds the structured stock recommendation from
// engine output (used by the stock page and by the AI as a fact base), and
// answers common questions without a language model when no AI key is set.
import { all } from "../db.ts";
import * as M from "../lib/market.ts";
import { executeTool } from "./tools.ts";
import { scale } from "../../shared/fundamentals.ts";

const f2 = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "n/a" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));

export function buildStockReport(symbol: string) {
  const a = M.analyzeStock(symbol);
  if (!a.company) return null;
  const fa = a.fundamentals;
  const t = a.technical;
  const factor = M.allFactors().find((f) => f.symbol === a.symbol);
  const comp = (re: RegExp) => fa?.score.components.find((c) => re.test(c.name))?.score ?? null;
  const vol = factor?.volatility ?? null;
  const scores = {
    fundamental: fa?.score.overall ?? null,
    technical: t?.technicalScore ?? null,
    valuation: comp(/Valuation/),
    financialHealth: comp(/health|quality|strength/i),
    risk: vol != null ? 100 - (scale(vol, 15, 60) ?? 50) : null, // higher = lower risk
  };
  const flags = fa?.redFlags.length ?? 0;
  let longTerm: string;
  if (scores.fundamental == null) longTerm = "Not enough fundamental data for a long-term view (no quarterly statements stored).";
  else if (scores.fundamental >= 65 && (scores.valuation ?? 50) >= 50 && flags === 0) longTerm = "Attractive for long-term accumulation on the current data (strong fundamentals at a reasonable valuation).";
  else if (scores.fundamental >= 65) longTerm = "Good business on the data, but valuation or flags argue for patience: accumulate only on dips toward support.";
  else if (scores.fundamental >= 45 && flags <= 1) longTerm = "Hold / watch: average fundamentals for its sector.";
  else longTerm = "Avoid for long-term investment until fundamentals improve.";
  const buy = a.setups.find((s) => s.side === "buy");
  const sell = a.setups.find((s) => s.side === "sell");
  let shortTerm: string;
  if (sell && (!buy || sell.quality > buy.quality)) shortTerm = `Caution: ${sell.type}.`;
  else if (buy && buy.quality >= 60) shortTerm = `Active ${buy.type.toLowerCase()} setup (quality ${buy.quality}/100).`;
  else if (buy) shortTerm = `Weak ${buy.type.toLowerCase()} setup (quality ${buy.quality}/100); wait for confirmation.`;
  else if ((t?.technicalScore ?? 50) < 35) shortTerm = "Technically weak: no new trades.";
  else shortTerm = "No active rule-based setup.";

  const bull: string[] = [...(fa?.strengths ?? [])];
  const bear: string[] = [...(fa?.redFlags ?? [])];
  if (t) {
    for (const f of t.scoreFactors) (f.points > 0 ? bull : bear).push(f.factor);
    if (t.rsi != null && t.rsi > 70) bear.push(`RSI ${t.rsi}: overbought in the short term.`);
  }
  for (const p of a.patterns) (p.direction === "bearish" ? bear : p.direction === "bullish" ? bull : []).push(`${p.name} (${p.status}): ${p.description}`);
  const v = fa?.byKey ?? {};
  if (v.npl != null && v.npl > 3 && v.npl <= 5) bear.push(`NPL ${v.npl}% is elevated (above 3%).`);
  if (v.pb != null && v.pb > 3) bear.push(`P/B ${v.pb}x is expensive relative to book value.`);
  if (v.car != null && v.car < 12.5 && v.car >= 11.5) bear.push(`Capital adequacy ${v.car}% leaves a thin buffer over the regulatory minimum.`);
  const sup = a.levels?.supports.slice(0, 3) ?? [];
  const res = a.levels?.resistances.slice(0, 3) ?? [];
  const report = {
    symbol: a.symbol, name: a.company.name, sector: a.company.sector,
    price: a.lastBar?.close ?? null, priceDate: a.lastBar?.date ?? null,
    verdict: { longTerm, shortTerm, method: "Rules: long-term from the sector-specific fundamental score, valuation and red flags; short-term from active technical setups and the technical score." },
    scores,
    marketContext: (() => { const m = M.marketSummary(); return m.trend ? `NEPSE trend: ${m.trend.label}. ${m.trend.notes.join(" ")} Breadth: ${m.sentiment?.label ?? "n/a"}.` : "Market trend unavailable (index history not loaded)."; })(),
    bullish: bull.slice(0, 8), bearish: bear.slice(0, 8),
    entry: buy ? { low: buy.entryLow, high: buy.entryHigh, setup: buy.type } : null,
    supports: sup.map((l) => ({ price: l.price, strength: l.strength, reactions: l.reactions })),
    resistances: res.map((l) => ({ price: l.price, strength: l.strength, reactions: l.reactions })),
    stopLoss: buy?.stopLoss ?? (sup[0] ? sup[0].low : null),
    targets: buy?.targets ?? res.map((r) => r.price),
    horizon: buy ? buy.horizon : "Long-term view only",
    riskReward: buy?.riskReward ?? null,
    invalidation: buy?.invalidation ?? (sup[0] ? [sup[0].invalidation] : []),
    dataFreshness: a.dataFreshness,
    sources: ["Daily prices: nepse-data (MIT) and ShareSansar", "Quarterly statements, dividends, company profile: ShareSansar company pages", "All scores and levels computed by Saphal Stocks engines"],
    facts: "Prices, statements and dividends are facts as published. Ratios, levels, patterns and scores are calculations. Verdicts are rule-based opinions, not predictions or advice.",
  };
  return report;
}

export function reportMarkdown(r: NonNullable<ReturnType<typeof buildStockReport>>) {
  const s = r.scores;
  return [
    `### ${r.symbol} · ${r.name ?? ""} (${r.sector ?? "sector n/a"})`,
    `Last close **Rs. ${f2(r.price)}** on ${r.priceDate ?? "n/a"}.`,
    `**Long-term:** ${r.verdict.longTerm}  \n**Short-term:** ${r.verdict.shortTerm}`,
    `| Fundamental | Technical | Valuation | Financial health | Risk (higher = safer) |\n|---|---|---|---|---|\n| ${s.fundamental ?? "n/a"} | ${s.technical ?? "n/a"} | ${s.valuation ?? "n/a"} | ${s.financialHealth ?? "n/a"} | ${s.risk ?? "n/a"} |`,
    `**Market context:** ${r.marketContext}`,
    r.bullish.length ? `**Bullish:**\n${r.bullish.map((b) => `- ${b}`).join("\n")}` : "",
    r.bearish.length ? `**Bearish:**\n${r.bearish.map((b) => `- ${b}`).join("\n")}` : "",
    r.entry ? `**Entry zone (${r.entry.setup}):** Rs. ${f2(r.entry.low)} - ${f2(r.entry.high)} · **Stop:** Rs. ${f2(r.stopLoss)} · **Targets:** ${r.targets.map((t) => "Rs. " + f2(t)).join(", ")} · **R:R** ${f2(r.riskReward)}` : "",
    `**Support:** ${r.supports.map((l) => `Rs. ${f2(l.price)} (${l.strength}, ${l.reactions} reactions)`).join(", ") || "n/a"}  \n**Resistance:** ${r.resistances.map((l) => `Rs. ${f2(l.price)} (${l.strength}, ${l.reactions} reactions)`).join(", ") || "n/a"}`,
    r.invalidation.length ? `**Invalidation:** ${r.invalidation.join(" ")}` : "",
    `*Data: prices to ${r.dataFreshness.lastPriceDate ?? "n/a"}, statements ${r.dataFreshness.latestReport ?? "not stored"}. ${r.facts}*`,
  ].filter(Boolean).join("\n\n");
}

/** Without an AI key: route the question to the right data tool and format the answer. */
export async function answerOffline(message: string, userId: number): Promise<string> {
  const text = message.trim();
  const upper = text.toUpperCase();
  const symbols = all<{ symbol: string }>("SELECT symbol FROM companies").map((r) => r.symbol);
  const mentioned = [...new Set((upper.match(/\b[A-Z][A-Z0-9]{1,9}\b/g) || []).filter((w) => symbols.includes(w) && !["THE", "AND", "FOR", "BUY", "IS", "IT"].includes(w)))];
  const lower = text.toLowerCase();
  const header = "_AI narrative is off (no API key configured), so this is a data-backed report generated by rules. Add an Anthropic API key in Settings for conversational analysis._\n\n";

  // Personal money questions: amounts like "5 lakh", "Rs 30,000", "NPR 500000".
  const amt = (() => { const m = lower.match(/(?:rs\.?|npr)?\s*([\d][\d,]*(?:\.\d+)?)\s*(lakh|lakhs|lac|crore|cr|k)?\b/); if (!m) return null; const v = Number(m[1].replace(/,/g, "")); const mul = /lakh|lac/.test(m[2] ?? "") ? 1e5 : /crore|cr/.test(m[2] ?? "") ? 1e7 : m[2] === "k" ? 1e3 : 1; return v * mul >= 1000 ? v * mul : null; })();
  if (/fixed deposit|\bfd\b|interest rate|best bank|which bank/.test(lower)) {
    const c = (await executeTool("compare_deposits", { amount: amt ?? 100000, months: /2 ?year|24 ?month/.test(lower) ? 24 : /6 ?month/.test(lower) ? 6 : 12 }, userId)) as { rows: { institution: string; product?: string | null; ratePct: number; netAnnualPct: number; realPct: number | null; maturity: number; method?: string | null; effectiveFrom?: string | null }[]; months: number; amount: number; inflationPct: number | null };
    return header + `**Fixed deposits for Rs. ${f2(c.amount, 0)} over ${c.months} months** (after 6% tax on interest):\n\n| Institution | Rate | After tax | After inflation | You get | Source |\n|---|---|---|---|---|---|\n` + c.rows.slice(0, 12).map((r) => `| ${r.institution}${r.product ? ` (${r.product})` : ""} | ${f2(r.ratePct)}% | ${f2(r.netAnnualPct)}% | ${f2(r.realPct)}% | Rs. ${f2(r.maturity, 0)} | ${r.method ?? ""} ${r.effectiveFrom ?? ""} |`).join("\n") +
      `\n\n${c.rows.length <= 1 ? "Only the NRB average is available. Open **Where to Invest → Deposit rates** to read the latest bank notices or add rates you have checked." : "AI-read rates should be checked against the linked notice."} Inflation: ${f2(c.inflationPct)}% (NRB).`;
  }
  if (/where should i (put|invest)|how should i invest|invest it|allocate|save .* every month|per month|monthly/.test(lower) && amt) {
    const monthly = /every month|per month|monthly|each month/.test(lower);
    const a = (await executeTool("advise_money_allocation", monthly ? { amount: amt * 12, monthly: amt } : { amount: amt }, userId)) as { buckets: { name: string; amount: number; guaranteed: boolean; returnText: string; why: string; options: string[] }[]; equityCapPct: number; projections: { years: number; low: number; mid: number; high: number }[]; monthlySplit: { name: string; amount: number }[]; rates: { sources: Record<string, string> } };
    return header + `**${monthly ? `Investing Rs. ${f2(amt, 0)} every month (first year shown)` : `Where to put Rs. ${f2(amt, 0)}`}**, based on your My Money data and current official rates:\n\n| Bucket | Amount | Return |\n|---|---|---|\n` + a.buckets.map((b) => `| ${b.name} | Rs. ${f2(b.amount, 0)} | ${b.guaranteed ? "Guaranteed" : "Not guaranteed"}: ${b.returnText} |`).join("\n") +
      `\n\n${a.buckets.map((b) => `- **${b.name}**: ${b.why} Options: ${b.options.join(", ")}.`).join("\n")}\n\n${monthly && a.monthlySplit.length ? `Each month: ${a.monthlySplit.map((m) => `${m.name} Rs. ${f2(m.amount, 0)}`).join(", ")}.\n\n` : ""}Expected value in ${a.projections[1].years} years: about Rs. ${f2(a.projections[1].mid, 0)} (range Rs. ${f2(a.projections[1].low, 0)} to Rs. ${f2(a.projections[1].high, 0)}; market-linked parts are not guaranteed).\n\nRates used: ${Object.values(a.rates.sources).join("; ")}.`;
  }
  if (/emergency fund|pay off|prepay|loan or invest|my budget|my spending|save more|savings rate|net worth|my money/.test(lower)) {
    const o = (await executeTool("get_my_money", {}, userId)) as { saved: boolean; summary: Record<string, number | null>; advice: { title: string; detail: string }[] };
    if (!o.saved) return header + "Fill in **My Money** (income, spending, savings and loans) first, then ask again for specific advice.";
    const s2 = o.summary;
    return header + `**Your money:** net worth Rs. ${f2(s2.netWorth, 0)}, monthly cash flow Rs. ${f2(s2.cashFlow, 0)}, savings rate ${f2(s2.savingsRatePct, 1)}%, emergency fund ${f2(s2.emergencyMonthsCovered, 1)} months${(s2.emergencyGap ?? 0) > 0 ? ` (short by Rs. ${f2(s2.emergencyGap, 0)})` : ""}.\n\n**What to do, in order:**\n${o.advice.map((a, i) => `${i + 1}. **${a.title}**: ${a.detail}`).join("\n") || "Nothing urgent: your basics are in place."}`;
  }
  if (/portfolio|my holdings|rebalanc|overexposed|dragging/.test(lower)) {
    const p = (await executeTool("get_portfolio", {}, userId)) as { portfolios: { name: string; totals: Record<string, number | null>; holdings: { symbol: string; weightPct: number | null; unrealizedPct: number | null; fundamentalScore: number | null; technicalScore: number | null; sector: string }[]; health: { score: number; issues: string[]; positives: string[]; sectorExposure: { sector: string; weightPct: number }[] } | null }[]; note?: string };
    if (!p.portfolios.length) return header + "You have no portfolios yet. Create one under **Portfolio** and add your transactions.";
    return header + p.portfolios.map((pf) => [
      `### ${pf.name}`,
      `Market value Rs. ${f2(pf.totals.marketValue, 0)}, unrealised P&L Rs. ${f2(pf.totals.unrealizedPnl, 0)}, total return ${f2(pf.totals.totalReturnPct)}%.`,
      pf.health ? `**Health score ${pf.health.score}/100.**\n${pf.health.issues.map((i) => `- ⚠ ${i}`).join("\n")}\n${pf.health.positives.map((i) => `- ✓ ${i}`).join("\n")}` : "",
      pf.health ? `**Sector exposure:** ${pf.health.sectorExposure.map((s) => `${s.sector} ${s.weightPct}%`).join(", ")}` : "",
      `| Holding | Weight | P&L % | Fundamental | Technical |\n|---|---|---|---|---|\n${pf.holdings.map((h) => `| ${h.symbol} | ${f2(h.weightPct, 1)}% | ${f2(h.unrealizedPct, 1)}% | ${h.fundamentalScore ?? "n/a"} | ${h.technicalScore ?? "n/a"} |`).join("\n")}`,
      `Holdings with weak fundamentals (<40) or weak technicals (<35) are the first candidates to review.`,
    ].filter(Boolean).join("\n\n")).join("\n\n");
  }
  if (mentioned.length >= 2 && /compar|vs|versus|better/.test(lower)) {
    const rows = (await executeTool("compare_stocks", { symbols: mentioned.slice(0, 6) }, userId)) as { symbol: string; factors: Record<string, number | null> | null; period?: string }[];
    const cols: [string, string][] = [["price", "Price"], ["pe", "P/E"], ["pb", "P/B"], ["roe", "ROE %"], ["cashYield", "Cash yield %"], ["fundamentalScore", "Fund. score"], ["technicalScore", "Tech. score"], ["return3m", "3m %"], ["return1y", "1y %"]];
    return header + `| Metric | ${rows.map((r) => r.symbol).join(" | ")} |\n|---|${rows.map(() => "---").join("|")}|\n` +
      cols.map(([k, l]) => `| ${l} | ${rows.map((r) => f2(r.factors?.[k] as number | null)).join(" | ")} |`).join("\n") +
      `\n\nStatement periods: ${rows.map((r) => `${r.symbol} ${r.period ?? "n/a"}`).join(", ")}. Open each stock page for the full analysis.`;
  }
  if (mentioned.length >= 1) {
    const out = mentioned.slice(0, 3).map((s) => { const r = buildStockReport(s); return r ? reportMarkdown(r) : `${s}: no data.`; });
    return header + out.join("\n\n---\n\n");
  }
  const strategies: [RegExp, string][] = [[/undervalued|cheap|value/, "value"], [/dividend/, "dividend"], [/growth|growing|improving eps/, "growth"], [/momentum|bullish/, "momentum"], [/swing/, "swing"], [/long.?term/, "longterm"], [/avoid/, "avoid"], [/deteriorat/, "deteriorating"], [/risk.?adjusted|safe/, "riskadjusted"], [/fundamental|strong|attractive|best|top/, "quality"]];
  if (/support/.test(lower)) {
    const r = (await executeTool("screen_stocks", { max_distance_to_support_pct: 3, min_avg_turnover: 2_000_000, sort_by: "fundamentalScore", limit: 15 }, userId)) as { rows: { symbol: string; name: string; price: number; nearestSupport?: { dist: number; level: number; strength: string } ; fundamentalScore: number | null; trend: string }[]; asOf: string };
    return header + `**Liquid stocks within 3% of their nearest support** (as of ${r.asOf}):\n\n| Stock | Price | Support | Distance | Strength | Trend | Fund. score |\n|---|---|---|---|---|---|---|\n` +
      r.rows.map((x) => `| ${x.symbol} | ${f2(x.price)} | ${f2(x.nearestSupport?.level)} | ${f2(x.nearestSupport?.dist)}% | ${x.nearestSupport?.strength ?? ""} | ${x.trend} | ${x.fundamentalScore ?? "n/a"} |`).join("\n") +
      "\n\nA support only matters if it holds: each stock page shows why the level matters and what would break it.";
  }
  if (/breakout|setup|trade|swing opportunit/.test(lower)) {
    const r = (await executeTool("get_trade_setups", { side: "buy", limit: 12 }, userId)) as { asOf: string; setups: { symbol: string; type: string; price: number; entry: number[]; stop: number; targets: number[]; rr: number; quality: number }[] };
    return header + `**Active rule-based setups** (as of ${r.asOf}):\n\n| Stock | Setup | Price | Entry | Stop | T1 | R:R | Quality |\n|---|---|---|---|---|---|---|---|\n` +
      r.setups.map((s) => `| ${s.symbol} | ${s.type} | ${f2(s.price)} | ${f2(s.entry[0])}-${f2(s.entry[1])} | ${f2(s.stop)} | ${f2(s.targets[0])} | ${f2(s.rr)} | ${s.quality} |`).join("\n");
  }
  for (const [re, key] of strategies) {
    if (re.test(lower)) {
      const sector = all<{ sector: string }>("SELECT DISTINCT sector FROM companies WHERE sector IS NOT NULL").map((r) => r.sector).find((s) => lower.includes(s.toLowerCase().replace(/ bank$/, "").split(" ")[0]));
      const r = (await executeTool("rank_stocks", { strategy: key, limit: 10, sector }, userId)) as { strategy: { name: string; description: string; weights: string[]; filters: string[] }; ranked: { rank: number; symbol: string; name: string; score: number; dataCoveragePct: number; price: number | null }[]; universe: number; excludedOrInsufficientData: number; asOf: string };
      return header + `**${r.strategy.name}${sector ? ` · ${sector}` : ""}** (as of ${r.asOf}). ${r.strategy.description}\n\nWeights: ${r.strategy.weights.join(", ")}. Filters: ${r.strategy.filters.join("; ") || "none"}. ${r.excludedOrInsufficientData} of ${r.universe} stocks excluded by filters or missing data.\n\n| # | Stock | Score | Price | Data coverage |\n|---|---|---|---|---|\n` +
        r.ranked.map((x) => `| ${x.rank} | ${x.symbol} · ${x.name} | ${x.score} | ${f2(x.price)} | ${x.dataCoveragePct}% |`).join("\n") +
        "\n\nScores rank stocks against each other on this model only. Open a stock for the full picture before acting.";
    }
  }
  if (/market|nepse|today/.test(lower)) {
    const m = M.marketSummary();
    const n = m.indices.find((i) => i.index_id === 12);
    return header + `**NEPSE on ${m.date}:** ${n ? `${f2(n.close)} (${f2(n.change_pct)}%)` : "index n/a"}. Advancers ${m.counts.advancers}, decliners ${m.counts.decliners}. Turnover Rs. ${f2(m.totals.turnover / 1e7, 2)} crore. ${m.trend ? `Trend: ${m.trend.label}.` : ""}\n\nTop gainers: ${m.gainers.slice(0, 5).map((g) => `${g.symbol} ${f2(g.changePct)}%`).join(", ")}.\nTop losers: ${m.losers.slice(0, 5).map((g) => `${g.symbol} ${f2(g.changePct)}%`).join(", ")}.`;
  }
  return header + "I can answer from data about: your money (\"where should I put Rs 5 lakh?\", \"I can save Rs 30,000 every month\", \"best fixed deposit\", \"emergency fund\"), a specific stock (mention its symbol, e.g. NABIL), comparisons (\"compare NABIL, EBL and SCB\"), rankings (undervalued, dividend, growth, momentum, swing, long-term, stocks to avoid), stocks near support, breakout setups, your portfolio, or today's market.";
}
