// Personal-growth helpers: what your own trades say about your habits, the checklist to run before
// every buy, and the action each holding needs. Pure functions; tested.

export interface JournalTrade { date: string; symbol: string; setup?: string; entry: number; stop: number; target: number; qty: number; exitDate?: string; exit?: number | null; emotion?: string; followedPlan?: boolean }
export type Tone = "good" | "bad" | "info";
export interface Insight { tone: Tone; title: string; text: string }

const r1 = (x: number) => Math.round(x * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));

/** Habits from closed journal trades: payoff, holding winners vs losers, stops honoured, early exits, revenge trades, emotions. */
export function habitReport(trades: JournalTrade[]) {
  const closed = trades.filter((t) => t.exit != null && t.exit > 0 && t.entry > 0).map((t) => {
    const pct = ((t.exit as number) - t.entry) / t.entry * 100;
    return { ...t, pct, held: t.exitDate ? days(t.date, t.exitDate) : null, win: (t.exit as number) > t.entry };
  }).sort((a, b) => (a.exitDate ?? a.date).localeCompare(b.exitDate ?? b.date));
  const wins = closed.filter((t) => t.win), losses = closed.filter((t) => !t.win);
  const avgWin = avg(wins.map((t) => t.pct)), avgLoss = avg(losses.map((t) => t.pct));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
  const expectancy = winRate != null ? ((winRate / 100) * (avgWin ?? 0) + (1 - winRate / 100) * (avgLoss ?? 0)) : null;
  const holdW = avg(wins.map((t) => t.held).filter((x): x is number => x != null)), holdL = avg(losses.map((t) => t.held).filter((x): x is number => x != null));
  const pastStop = losses.filter((t) => t.stop > 0 && (t.exit as number) < t.stop * 0.98);
  const early = wins.filter((t) => t.target > t.entry && (t.exit as number) < t.entry + (t.target - t.entry) * 0.5);
  let streak = 0, worst = 0; for (const t of closed) { streak = t.win ? 0 : streak + 1; worst = Math.max(worst, streak); }
  // A "revenge" trade: a new trade opened within 2 days of closing a loss.
  const revenge = trades.filter((t) => losses.some((l) => !!l.exitDate && t.date >= l.exitDate && days(l.exitDate, t.date) <= 2 && !(t.symbol === l.symbol && t.date === l.date))).length;
  const wideStops = trades.filter((t) => t.stop > 0 && (t.entry - t.stop) / t.entry > 0.1).length;
  const noStop = trades.filter((t) => !(t.stop > 0)).length;
  const byEmotion = new Map<string, { n: number; w: number }>();
  for (const t of closed) { const e = (t.emotion || "").trim().toLowerCase() || "not recorded"; const x = byEmotion.get(e) ?? { n: 0, w: 0 }; x.n++; if (t.win) x.w++; byEmotion.set(e, x); }
  const followed = closed.filter((t) => t.followedPlan), broke = closed.filter((t) => t.followedPlan === false);

  const out: Insight[] = [];
  if (closed.length < 3) out.push({ tone: "info", title: "Log more trades", text: `Only ${closed.length} closed trade${closed.length === 1 ? "" : "s"} in your journal. After 10 or more, these habits become reliable.` });
  if (avgWin != null && avgLoss != null) {
    const payoff = Math.abs(avgWin / avgLoss);
    out.push(payoff >= 1.5 ? { tone: "good", title: `Your wins are ${r1(payoff)}× your losses`, text: `Average win +${r1(avgWin)}%, average loss ${r1(avgLoss)}%. Keep cutting losses small.` }
      : { tone: "bad", title: `Your wins are only ${r1(payoff)}× your losses`, text: `Average win +${r1(avgWin)}%, average loss ${r1(avgLoss)}%. Aim for wins at least 2× losses: take trades with targets twice as far as the stop, and exit at the stop.` });
  }
  if (expectancy != null && closed.length >= 3) out.push(expectancy > 0 ? { tone: "good", title: `Each trade earns about ${r1(expectancy)}% on average`, text: "Your system makes money over many trades. Stay consistent with position size." } : { tone: "bad", title: `Each trade loses about ${r1(Math.abs(expectancy))}% on average`, text: "Your current approach loses money over time. Trade smaller, only take setups with risk:reward of 2 or more, and review which setups lose." });
  if (holdW != null && holdL != null && holdL > holdW * 1.5 && losses.length >= 2) out.push({ tone: "bad", title: "You hold losers longer than winners", text: `Losers held ${Math.round(holdL)} days on average vs winners ${Math.round(holdW)} days. This "hope" habit is the most common way traders lose money: sell when the stop is hit.` });
  if (pastStop.length) out.push({ tone: "bad", title: `${pastStop.length} loss${pastStop.length === 1 ? "" : "es"} went past your stop-loss`, text: `${pastStop.map((t) => t.symbol).slice(0, 5).join(", ")}: the exit was more than 2% below the planned stop. Place the stop the day you buy and act on it.` });
  if (early.length >= 2) out.push({ tone: "bad", title: `${early.length} winners sold before halfway to target`, text: "Taking profit too early caps your gains. Sell half at the first target and let the rest run with the stop moved to your buy price." });
  if (worst >= 3) out.push({ tone: "info", title: `Longest losing streak: ${worst} trades`, text: "Losing streaks are normal. Halve your position size after 3 losses in a row until you win again." });
  if (revenge >= 2) out.push({ tone: "bad", title: `${revenge} trades opened within 2 days of a loss`, text: "Quick trades right after a loss are often revenge trades. Wait a day and use the pre-buy checklist." });
  if (noStop) out.push({ tone: "bad", title: `${noStop} trade${noStop === 1 ? "" : "s"} without a stop-loss`, text: "Every trade needs a price where you admit you're wrong." });
  if (wideStops) out.push({ tone: "info", title: `${wideStops} trade${wideStops === 1 ? "" : "s"} with a stop more than 10% away`, text: "Wide stops mean big losses or tiny positions. Prefer entries near support so the stop can be close." });
  if (followed.length >= 2 && broke.length >= 2) {
    const fw = (followed.filter((t) => t.win).length / followed.length) * 100, bw = (broke.filter((t) => t.win).length / broke.length) * 100;
    out.push(fw >= bw ? { tone: "good", title: `Following your plan works: ${Math.round(fw)}% vs ${Math.round(bw)}% wins`, text: "Your results are better when you stick to the plan." } : { tone: "info", title: `Breaking the plan won ${Math.round(bw)}% vs ${Math.round(fw)}%`, text: "Your written plans may need better entries or targets. Review the plans you broke." });
  }
  const emo = [...byEmotion.entries()].filter(([, x]) => x.n >= 2).map(([e, x]) => ({ emotion: e, trades: x.n, winRatePct: Math.round((x.w / x.n) * 100) })).sort((a, b) => a.winRatePct - b.winRatePct);
  if (emo.length >= 2 && emo[0].winRatePct + 25 <= emo[emo.length - 1].winRatePct) out.push({ tone: "bad", title: `Trades made feeling "${emo[0].emotion}" won only ${emo[0].winRatePct}%`, text: `Compared with ${emo[emo.length - 1].winRatePct}% when "${emo[emo.length - 1].emotion}". Skip trades when you feel ${emo[0].emotion}.` });
  return { closed: closed.length, open: trades.length - closed.length, winRatePct: winRate != null ? Math.round(winRate) : null, avgWinPct: avgWin != null ? r1(avgWin) : null, avgLossPct: avgLoss != null ? r1(avgLoss) : null, expectancyPct: expectancy != null ? r1(expectancy) : null, holdWinDays: holdW != null ? Math.round(holdW) : null, holdLossDays: holdL != null ? Math.round(holdL) : null, worstStreak: worst, emotions: emo, insights: out };
}

export interface PreTradeInput {
  price: number; entryHigh: number | null; stop: number | null; target: number | null; verdict: string;
  capital: number; riskPct: number; avgTurnover: number | null; sectorWeightAfterPct: number | null; daysToBookClose: number | null; openPositions: number;
}
export interface Check { ok: boolean | null; label: string; detail: string }

/** The pre-buy checklist: position size from your risk, then each rule as pass / fail / unknown. */
export function preTrade(p: PreTradeInput) {
  const riskPerShare = p.stop != null && p.stop < p.price ? p.price - p.stop : null;
  const riskRs = p.capital * (p.riskPct / 100);
  const qty = riskPerShare ? Math.max(0, Math.floor(riskRs / riskPerShare)) : 0;
  const cost = qty * p.price;
  const sized = cost > p.capital ? Math.floor(p.capital / p.price) : qty;
  const rr = riskPerShare && p.target != null ? (p.target - p.price) / riskPerShare : null;
  const checks: Check[] = [
    { ok: p.stop != null && p.stop < p.price, label: "Stop-loss set below the price", detail: p.stop != null ? `Stop Rs. ${p.stop} (${r1(((p.stop - p.price) / p.price) * 100)}%)` : "No stop: decide where you are wrong before buying." },
    { ok: rr != null ? rr >= 2 : null, label: "Reward at least 2× the risk", detail: rr != null ? `Risk:reward 1 : ${r1(rr)}` : "Needs a stop and a target." },
    { ok: p.riskPct <= 2, label: "Risking 2% of capital or less", detail: `You risk ${p.riskPct}% = Rs. ${Math.round(riskRs).toLocaleString("en-IN")} if the stop is hit.` },
    { ok: /BUY/.test(p.verdict) ? true : /SELL/.test(p.verdict) ? false : null, label: "The signal agrees", detail: `App verdict: ${p.verdict}.` },
    { ok: p.entryHigh != null ? p.price <= p.entryHigh * 1.01 : null, label: "Not chasing the price", detail: p.entryHigh != null ? (p.price <= p.entryHigh * 1.01 ? `Price is within the buy zone (≤ Rs. ${p.entryHigh}).` : `Price is above the buy zone top Rs. ${p.entryHigh}; wait for a pullback.`) : "No buy zone for this stock now." },
    { ok: p.avgTurnover != null ? p.avgTurnover >= 1_000_000 : null, label: "Easy to sell (liquid)", detail: p.avgTurnover != null ? `Average daily turnover Rs. ${Math.round(p.avgTurnover / 1000).toLocaleString("en-IN")}k${p.avgTurnover < 1_000_000 ? ": thin trading, you may not exit at your stop" : ""}.` : "Turnover unknown." },
    { ok: p.sectorWeightAfterPct != null ? p.sectorWeightAfterPct <= 40 : null, label: "Sector stays under 40% of your portfolio", detail: p.sectorWeightAfterPct != null ? `After this buy: ${r1(p.sectorWeightAfterPct)}% in this sector.` : "No portfolio to compare." },
    { ok: p.daysToBookClose != null ? !(p.daysToBookClose >= 0 && p.daysToBookClose <= 5) : null, label: "No book closure in the next 5 days", detail: p.daysToBookClose != null && p.daysToBookClose >= 0 ? `Book closure in ${p.daysToBookClose} day(s): the price usually drops by the dividend afterwards.` : "No upcoming book closure found." },
    { ok: p.openPositions < 10, label: "Not too many open trades", detail: `${p.openPositions} open trade(s) in your journal.` },
  ];
  const fails = checks.filter((c) => c.ok === false).length;
  return { riskPerShare: riskPerShare != null ? Math.round(riskPerShare * 100) / 100 : null, riskRs: Math.round(riskRs), qty: sized, cost: Math.round(sized * p.price), riskRR: rr != null ? r1(rr) : null, checks, fails, go: fails === 0 ? "GO" : fails <= 1 ? "CAREFUL" : "DON'T BUY" };
}

export interface HoldingAction { level: "urgent" | "act" | "watch" | "ok"; action: string; why: string }
/** What a holding needs today, from its price, cost, weight and the chart verdict. */
export function holdingAction(h: { symbol: string; price: number | null; wacc: number; weightPct: number; unrealizedPct: number | null; verdict: string | null; stop: number | null; t1: number | null; buyZoneHigh: number | null; qty: number; holdings?: number }): HoldingAction {
  const p = h.price;
  if (p == null) return { level: "watch", action: "No price", why: "No recent price for this stock." };
  if (h.stop != null && p < h.stop) return { level: "urgent", action: `Sell: price below stop Rs. ${h.stop}`, why: `The close Rs. ${p} broke the stop-loss level; the chart's reason to hold has failed.` };
  if (/SELL/.test(h.verdict ?? "")) return { level: "act", action: h.weightPct > 5 ? `Reduce: sell about half (${Math.floor(h.qty / 2)} shares)` : "Consider selling", why: `The chart verdict is ${h.verdict}.` };
  if (h.weightPct > 25 && (h.holdings ?? 5) < 4) return { level: "watch", action: "Diversify with new money", why: `You own only ${h.holdings} stock${h.holdings === 1 ? "" : "s"}, so ${r1(h.weightPct)}% is in ${h.symbol}. Spread new money over 5+ stocks in different sectors instead of selling.` };
  if (h.weightPct > 25) { const target = Math.ceil(h.qty * (1 - 20 / h.weightPct)); return { level: "act", action: `Trim: sell about ${target} shares`, why: `${r1(h.weightPct)}% of your portfolio is in one stock; bring it to about 20%.` }; }
  if (h.t1 != null && p >= h.t1) return { level: "act", action: "Take partial profit", why: `Price reached the first target Rs. ${h.t1}. Sell part and move the stop up.` };
  if (h.unrealizedPct != null && h.unrealizedPct <= -20) return { level: "watch", action: "Review the reason you bought", why: `Down ${r1(Math.abs(h.unrealizedPct))}% from your cost Rs. ${h.wacc}.` };
  if (/BUY/.test(h.verdict ?? "") && h.weightPct < 10 && h.buyZoneHigh != null && p <= h.buyZoneHigh) return { level: "ok", action: "Can add in the buy zone", why: `Verdict ${h.verdict}; price is within the buy zone and the position is small.` };
  return { level: "ok", action: "Hold", why: h.stop != null ? `Keep holding while above Rs. ${h.stop}.` : "No warning signs." };
}

// ---------- Wealth roadmap: the order in which money builds wealth, checked against your own numbers ----------
export interface RoadStep { n: number; title: string; status: "done" | "doing" | "todo" | "unknown"; detail: string; to: string; cta: string }
export function wealthRoadmap(s: { income: number; expenses: number; cashFlow: number; savingsRatePct: number | null; emergencyMonthsCovered: number | null; emergencyGap: number; debtServicePct: number | null; weightedDebtRatePct: number | null; equityPct: number | null; netWorth: number }, d: { accounts: { type: string; balance: number }[]; liabilities: { type: string; balance: number; ratePct: number }[]; emergencyMonths: number; saved: boolean }, extra: { holdings: number; sectorTopPct: number | null; journalTrades: number }): RoadStep[] {
  const has = (t: string) => d.accounts.some((a) => a.type === t && a.balance > 0);
  const costly = d.liabilities.filter((l) => l.balance > 0 && (l.type === "credit_card" || l.ratePct >= 14));
  const ret = d.accounts.filter((a) => ["pf", "cit", "ssf"].includes(a.type)).reduce((x, a) => x + a.balance, 0);
  const steps: RoadStep[] = [];
  const push = (title: string, status: RoadStep["status"], detail: string, to: string, cta: string) => steps.push({ n: steps.length + 1, title, status, detail, to, cta });
  if (!d.saved) push("Fill in My Money", "todo", "Add your income, spending, savings and loans once; every step below then checks itself.", "/money", "Open My Money");
  push("Spend less than you earn", !d.saved ? "unknown" : s.cashFlow > 0 ? (s.savingsRatePct != null && s.savingsRatePct >= 20 ? "done" : "doing") : "todo",
    !d.saved ? "Track a month of income and spending." : s.cashFlow > 0 ? `You save ${s.savingsRatePct ?? "—"}% of income${(s.savingsRatePct ?? 0) < 20 ? "; aim for 20% or more" : ""}.` : "Spending is above income: cut non-essential spending first.", "/money?tab=tracker", "Track spending");
  push(`Emergency fund: ${d.emergencyMonths} months of expenses`, !d.saved ? "unknown" : s.emergencyGap <= 0 ? "done" : (s.emergencyMonthsCovered ?? 0) >= 1 ? "doing" : "todo",
    !d.saved ? "Keep 3–6 months of expenses in a savings account." : s.emergencyGap <= 0 ? `Covered (${s.emergencyMonthsCovered} months).` : `Covered ${s.emergencyMonthsCovered ?? 0} months; Rs. ${Math.round(s.emergencyGap).toLocaleString("en-IN")} to go.`, "/money?tab=accounts", "Savings & investments");
  push("Protect your family: term life and health insurance", !d.saved ? "unknown" : has("insurance") ? "done" : "todo", has("insurance") ? "Insurance recorded. Prefer pure term cover over savings-linked policies; premiums are tax-deductible up to the limits." : "One hospital bill or loss of income can undo years of saving. Term life + health cover come before investing.", "/future", "Insurance options");
  push("Pay off costly debt", !d.saved ? "unknown" : costly.length ? "todo" : "done", costly.length ? `${costly.length} loan(s) at 14%+ or credit cards: repaying them is a guaranteed return higher than deposits.` : "No costly debt.", "/invest?tab=loan", "Prepay or invest?");
  push("Use the tax-saving retirement funds (SSF, CIT, EPF)", !d.saved ? "unknown" : ret > 0 ? "done" : "todo", ret > 0 ? `Rs. ${Math.round(ret).toLocaleString("en-IN")} in retirement funds; contributions cut your income tax (up to a third of income, within the cap).` : "Contributions to SSF/CIT/EPF reduce your income tax and build a retirement fund.", "/calculators#income-tax", "Income tax calculator");
  push("Invest every month in a diversified plan", extra.holdings >= 5 ? "done" : extra.holdings > 0 || has("mutual_fund") || has("stocks") ? "doing" : "todo", extra.holdings >= 5 ? `${extra.holdings} holdings.` : "Start a SIP in a mutual fund and/or build 5+ strong stocks across sectors, plus deposits and a little gold.", "/invest", "Build my plan");
  push("Keep risk in check", extra.sectorTopPct == null ? "unknown" : extra.sectorTopPct <= 40 ? "done" : "todo", extra.sectorTopPct == null ? "Add your shares to Portfolio to check concentration." : extra.sectorTopPct <= 40 ? `Largest sector ${extra.sectorTopPct}% of your shares.` : `${extra.sectorTopPct}% in one sector: spread new money elsewhere.`, "/growth?tab=holdings", "Holdings plan");
  push("Learn from every trade", extra.journalTrades >= 10 ? "done" : extra.journalTrades > 0 ? "doing" : "todo", extra.journalTrades ? `${extra.journalTrades} trades in your journal.` : "Write down each trade's reason, stop and target; review monthly.", "/growth?tab=coach", "Discipline coach");
  push("Grow your income", "unknown", "Skills, a side business or a promotion raise what you can invest each month — usually the biggest lever of all.", "/future", "Ideas");
  return steps;
}
