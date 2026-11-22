// Full research verdict for one stock. Before any recommendation it studies eight areas and shows each with its
// reasons: the chart setup, all indicators together, the business (statements and valuation), the latest reports
// (quarterly trend, audited report), news and events, the market and sector, smart money and manipulation (Wyckoff
// phase, money flow, broker-by-broker floorsheet, operator footprints) and the economy, policy and politics. The final decision needs these to
// agree: a chart BUY with a weak business, bad news or a falling market is downgraded, and the reasons say why.
// Rule-based and educational, built only on stored data. It never claims certainty and never invents figures; where
// something cannot be judged (for example the text of an audit opinion), it says so and links to the source.
import type { Opportunity, FundamentalInput, LiveCheck } from "./opportunities.ts";
import type { FundamentalAnalysis } from "./fundamentals.ts";
import type { SmartMoney } from "./smartMoney.ts";
import type { Macro } from "./macro.ts";

export type Verdict = "positive" | "neutral" | "negative" | "unknown";
export interface Pillar { key: string; title: string; verdict: Verdict; score: number | null; summary: string; reasons: string[]; links?: { label: string; url: string }[] }
export type Decision = "STRONG BUY" | "BUY" | "ACCUMULATE" | "WATCH" | "HOLD" | "REDUCE" | "SELL" | "AVOID" | "NO CALL";
export interface Research {
  symbol: string; name: string; sector: string; asOf: string | null; price: number | null;
  decision: Decision; tone: "up" | "down" | "warn" | "blue"; conviction: "High" | "Medium" | "Low";
  headline: string; horizon: string;
  pillars: Pillar[]; agree: { positive: number; negative: number; known: number };
  plan: { entry: string | null; stop: string | null; targets: string[]; exit: string[]; size: string | null };
  whyNot: string[]; changeMind: string[];
  smart: SmartMoney | null; macroSummary: { verdict: string; summary: string; asOf: string | null } | null;
}

export interface NewsItem { date: string | null; title: string; category: string | null; url: string | null }
export interface ResearchInput {
  symbol: string; name: string; sector: string;
  opp: Opportunity & { history?: { trades: number; winRatePct: number | null; avgNetPct: number | null } | null; live?: LiveCheck | null };
  fa: FundamentalAnalysis | null; faIn: FundamentalInput | null;
  indicators: { bull: number; bear: number; neutral: number } | null;
  news: NewsItem[];
  dividends: { fiscalYear: string; cashPct: number | null; bonusPct: number | null; bookCloseDate: string | null }[];
  audit: { fiscalYear: string | null; published: string | null; url: string } | null;
  market: { mood: number | null; nepse: { close: number; sma50: number | null; sma200: number | null } | null };
  sectorIndex: { name: string; close: number; sma50: number | null; sma200: number | null; ret20: number | null } | null;
  smart?: SmartMoney | null; macro?: Macro | null;
  today: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const rs = (x: number) => `Rs. ${Math.round(x * 100) / 100}`;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// News words. Only clear phrases count; every headline is shown so you can read it yourself.
const GOOD = /(cash dividend|bonus share|dividend of|proposed .*dividend|net profit (has )?(increased|grew|rose|up)|profit (increased|grew|rose|surged|jumped)|record profit|upgrad|rating .*(affirm|upgrad)|license (granted|received)|commercial operation|\bCOD\b|started (commercial|production))/i;
const BAD = /(penalt|fine[sd]? |fined|suspend|halt|fraud|investigat|default|downgrad|net loss|loss of rs|profit (declined|decreased|fell|dropped)|net profit (has )?(declined|decreased|fell|dropped)|npl (rose|increased)|blacklist|action against|show cause|cancel|resign|flood|damage|shutdown|closed? down)/i;
const DILUTE = /(right share|rights? issue|fpo|further public offer)/i;

export function research(inp: ResearchInput): Research {
  const o = inp.opp, fa = inp.fa, today = inp.today;
  const price = o.price;
  const pillars: Pillar[] = [];

  // 1. Chart setup (the daily signal on closing prices).
  {
    const ind = o.indicators;
    const reasons = [...o.techReasons.slice(0, 4)];
    if (ind.maPosition) reasons.push(`Moving averages: ${ind.maPosition}.`);
    if (ind.rsi != null) reasons.push(`RSI ${r1(ind.rsi)}${ind.rsi > 70 ? " (overbought)" : ind.rsi < 30 ? " (oversold)" : ""}.`);
    if (ind.volumeRatio != null) reasons.push(`Volume ${r1(ind.volumeRatio)}x its average${ind.volumeConfirmed ? ", confirming the move" : ""}.`);
    const v: Verdict = o.action === "BUY" ? "positive" : o.action === "SELL" || o.action === "AVOID" ? "negative" : o.action === "INSUFFICIENT" ? "unknown" : o.action === "HOLD" ? "positive" : "neutral";
    pillars.push({ key: "chart", title: "Chart setup", verdict: v, score: o.action === "INSUFFICIENT" ? null : o.confidence, summary: o.headline, reasons });
  }
  // 2. All indicators together.
  {
    const t = inp.indicators;
    const n = t ? t.bull + t.bear + t.neutral : 0;
    if (!t || n < 10) pillars.push({ key: "indicators", title: "All indicators", verdict: "unknown", score: null, summary: "Not enough price history to read the indicators.", reasons: [] });
    else {
      const bullPct = (t.bull / n) * 100, bearPct = (t.bear / n) * 100;
      const v: Verdict = bullPct >= 55 && bullPct - bearPct >= 20 ? "positive" : bearPct >= 55 && bearPct - bullPct >= 20 ? "negative" : "neutral";
      pillars.push({ key: "indicators", title: "All indicators", verdict: v, score: Math.round(50 + (bullPct - bearPct) / 2), summary: `${t.bull} of ${n} indicators read bullish, ${t.bear} bearish, ${t.neutral} neutral.`, reasons: [v === "positive" ? "Most trend, momentum and volume indicators agree on the upside." : v === "negative" ? "Most trend, momentum and volume indicators point down." : "The indicators are split: no clear majority."] });
    }
  }
  // 3. The business: statements, valuation, red flags.
  {
    if (!fa || fa.score.overall == null) pillars.push({ key: "business", title: "Business and valuation", verdict: "unknown", score: null, summary: "No quarterly statements stored, so the business cannot be judged.", reasons: [] });
    else {
      const s = fa.score.overall, val = fa.score.components.find((c) => /Valuation/.test(c.name))?.score ?? null;
      const reasons: string[] = [];
      const pe = fa.byKey.pe, pb = fa.byKey.pb, roe = fa.byKey.roe;
      const odd = (pe != null && pe > 0 && pe < 1) || (pb != null && pb > 0 && pb < 0.1);
      if (odd) reasons.push("Valuation figures look inconsistent with the report (P/E below 1); not used. Check the report.");
      else if (pe != null && pe > 0) reasons.push(`P/E ${r1(pe)}${pb != null ? `, P/B ${r1(pb)}` : ""}${roe != null ? `, ROE ${r1(roe)}%` : ""}${val != null ? `; valuation score ${val}/100` : ""}.`);
      for (const x of fa.strengths.slice(0, 3)) reasons.push(x);
      for (const x of fa.redFlags.slice(0, 3)) reasons.push(`Caution: ${x}`);
      let v: Verdict = s >= 60 && fa.redFlags.length < 2 ? "positive" : s < 40 || fa.redFlags.length >= 3 ? "negative" : "neutral";
      if (odd && v === "positive") v = "neutral";
      pillars.push({ key: "business", title: "Business and valuation", verdict: v, score: s, summary: `Fundamental score ${s}/100 for its sector (${fa.latestPeriod ?? "latest report"}).`, reasons });
    }
  }
  // 4. Reports: quarterly trend and the audited report.
  {
    const reasons: string[] = [];
    const links: { label: string; url: string }[] = [];
    let v: Verdict = "unknown", score: number | null = null;
    const yoy = fa?.growth.find((g) => g.label.startsWith("Net profit YoY"))?.value ?? null;
    if (yoy != null) { reasons.push(`Net profit ${yoy >= 0 ? "up" : "down"} ${Math.abs(r1(yoy))}% on the same period last year.`); v = yoy >= 10 ? "positive" : yoy <= -15 ? "negative" : "neutral"; score = Math.max(0, Math.min(100, Math.round(50 + yoy))); }
    const rev = fa?.growth.find((g) => g.label.startsWith("Revenue"))?.value ?? null;
    if (rev != null) reasons.push(`Revenue / operating income ${rev >= 0 ? "up" : "down"} ${Math.abs(r1(rev))}% year on year.`);
    if (fa?.latestPeriod) reasons.push(`Latest quarterly report: ${fa.latestPeriod}.`);
    if (inp.audit) { reasons.push(`Latest audited annual report found: ${inp.audit.fiscalYear ?? "year not stated"}${inp.audit.published ? `, published ${inp.audit.published}` : ""}. The auditor's opinion is not read automatically: open it to check for a qualified opinion or emphasis of matter.`); links.push({ label: `Audited report ${inp.audit.fiscalYear ?? ""}`.trim(), url: inp.audit.url }); }
    else reasons.push("No audited annual report stored yet.");
    if (yoy == null && v === "unknown") reasons.unshift("Year-on-year growth needs last year's same-quarter report.");
    pillars.push({ key: "reports", title: "Quarterly and audit reports", verdict: v, score, summary: yoy != null ? `Profit trend ${v === "positive" ? "improving" : v === "negative" ? "falling" : "flat"}.` : "Profit trend not measurable yet.", reasons, links });
  }
  // 5. News and events (last 45 days) and upcoming book closures.
  {
    const recent = inp.news.filter((n) => !n.date || days(n.date, today) <= 45);
    const good = recent.filter((n) => GOOD.test(n.title)), bad = recent.filter((n) => BAD.test(n.title)), dil = recent.filter((n) => DILUTE.test(n.title) || n.category === "Right share");
    const reasons: string[] = [];
    for (const n of good.slice(0, 2)) reasons.push(`Positive: ${n.title}${n.date ? ` (${n.date})` : ""}`);
    for (const n of bad.slice(0, 2)) reasons.push(`Negative: ${n.title}${n.date ? ` (${n.date})` : ""}`);
    for (const n of dil.slice(0, 1)) reasons.push(`Dilution: ${n.title}. A right share issue adds shares; the price adjusts down after book closure.`);
    const up = inp.dividends.find((d) => d.bookCloseDate && d.bookCloseDate >= today && days(today, d.bookCloseDate) <= 30);
    if (up) reasons.push(`Book closure on ${up.bookCloseDate} for ${up.cashPct ? `${up.cashPct}% cash` : ""}${up.cashPct && up.bonusPct ? " + " : ""}${up.bonusPct ? `${up.bonusPct}% bonus` : ""} (${up.fiscalYear}). Buy before it to receive it; the price is adjusted after.`);
    if (!reasons.length) reasons.push(recent.length ? `${recent.length} recent notices, none clearly positive or negative.` : "No notices in the last 45 days.");
    const v: Verdict = bad.length > good.length ? "negative" : good.length > bad.length && !dil.length ? "positive" : recent.length ? "neutral" : "unknown";
    pillars.push({ key: "news", title: "News and events", verdict: v, score: null, summary: bad.length ? "Recent negative news needs a look." : good.length ? "Recent news is supportive." : "Nothing major in the news.", reasons, links: [...good, ...bad, ...dil].slice(0, 4).filter((n) => n.url).map((n) => ({ label: n.title.slice(0, 80), url: n.url! })) });
  }
  // 6. Market and sector.
  {
    const reasons: string[] = [];
    const m = inp.market;
    let pts = 0, cnt = 0;
    if (m.mood != null) { reasons.push(`Market mood ${Math.round(m.mood)}/100 (${m.mood < 25 ? "extreme fear" : m.mood < 45 ? "fear" : m.mood <= 55 ? "neutral" : m.mood <= 75 ? "greed" : "extreme greed"}).`); pts += m.mood >= 55 ? 1 : m.mood < 35 ? -1 : 0; cnt++; }
    if (m.nepse) { const up = m.nepse.sma50 != null && m.nepse.close > m.nepse.sma50, up2 = m.nepse.sma200 != null && m.nepse.close > m.nepse.sma200; reasons.push(`NEPSE ${Math.round(m.nepse.close)}: ${up ? "above" : "below"} its 50-day and ${up2 ? "above" : "below"} its 200-day average.`); pts += up && up2 ? 1 : !up && !up2 ? -1 : 0; cnt++; }
    const si = inp.sectorIndex;
    if (si) { const up = si.sma50 != null && si.close > si.sma50; reasons.push(`${si.name}: ${up ? "above" : "below"} its 50-day average${si.ret20 != null ? `, ${si.ret20 >= 0 ? "+" : ""}${r1(si.ret20)}% in 20 sessions` : ""}.`); pts += up && (si.ret20 ?? 0) > 0 ? 1 : !up && (si.ret20 ?? 0) < 0 ? -1 : 0; cnt++; }
    const v: Verdict = !cnt ? "unknown" : pts >= 2 ? "positive" : pts <= -2 ? "negative" : "neutral";
    pillars.push({ key: "market", title: "Market and sector", verdict: v, score: cnt ? Math.round(50 + (pts / cnt) * 50) : null, summary: v === "positive" ? "The market and sector are helping." : v === "negative" ? "The market and sector are working against new buys." : "The market and sector are mixed.", reasons });
  }

  // 7. Smart money and manipulation.
  const sm = inp.smart ?? null;
  if (!sm) pillars.push({ key: "smart", title: "Smart money and manipulation", verdict: "unknown", score: null, summary: "Not studied.", reasons: [] });
  else pillars.push({ key: "smart", title: "Smart money and manipulation", verdict: sm.verdict, score: sm.score, summary: sm.summary, reasons: sm.reasons });
  // 8. Economy, policy and politics.
  const mc = inp.macro ?? null;
  if (!mc) pillars.push({ key: "macro", title: "Economy, policy and politics", verdict: "unknown", score: null, summary: "No economic data stored.", reasons: [] });
  else {
    const reasons = mc.points.map((x) => `${x.effect === "positive" ? "Supportive" : x.effect === "negative" ? "Against" : "Neutral"}: ${x.label} ${x.value}. ${x.why}`);
    for (const x of (mc.sectorNotes[inp.sector] ?? []).slice(0, 3)) reasons.push(`For ${inp.sector}: ${x}`);
    const heads = mc.news.filter((x) => x.theme !== "Market").slice(0, 5);
    for (const x of heads) reasons.push(`${x.theme} (${x.tone}): ${x.title}${x.date ? ` (${x.date})` : ""}`);
    reasons.push(...mc.calendar);
    pillars.push({ key: "macro", title: "Economy, policy and politics", verdict: mc.verdict, score: mc.score, summary: `${mc.summary} News tone, last 3 weeks: ${mc.newsTone.positive} supportive, ${mc.newsTone.negative} negative headlines.`, reasons, links: [...(mc.source ? [{ label: "NRB macroeconomic report", url: mc.source }] : []), ...heads.filter((x) => x.url).slice(0, 3).map((x) => ({ label: x.title.slice(0, 80), url: x.url! }))] });
  }

  const P = (k: string) => pillars.find((x) => x.key === k)!;
  const known = pillars.filter((x) => x.verdict !== "unknown");
  const agree = { positive: known.filter((x) => x.verdict === "positive").length, negative: known.filter((x) => x.verdict === "negative").length, known: known.length };
  const whyNot: string[] = [];
  const hist = o.history;
  const tr = hist && hist.trades >= 10 ? ` This setup type won ${Math.round(hist.winRatePct ?? 0)}% of ${hist.trades} past trades (avg ${r1(hist.avgNetPct ?? 0)}% net).` : "";

  // Final decision.
  let decision: Decision = "WATCH", headline = "", horizon = "1-4 weeks (trade)";
  const bizBad = P("business").verdict === "negative", newsBad = P("news").verdict === "negative", mktBad = P("market").verdict === "negative", indBad = P("indicators").verdict === "negative";
  const bizGood = P("business").verdict === "positive", repGood = P("reports").verdict !== "negative";
  if (o.action === "INSUFFICIENT") { decision = "NO CALL"; headline = o.headline; }
  else if (o.action === "AVOID") { decision = "AVOID"; headline = o.headline; }
  else if (o.action === "SELL") { decision = bizGood && !newsBad ? "REDUCE" : "SELL"; headline = decision === "REDUCE" ? "The chart turned down, but the business is sound: reduce or protect with a stop rather than exit everything." : "Chart breakdown with no strong business support: sell or exit."; }
  else if (o.action === "BUY") {
    if (bizBad) whyNot.push("The business is weak (low fundamental score or several red flags).");
    if (newsBad) whyNot.push("Recent news is negative.");
    if (mktBad) whyNot.push("The market and sector are falling.");
    if (indBad) whyNot.push("Most indicators disagree with the setup.");
    if (sm?.blocksBuy) whyNot.push(sm.blocksBuy);
    else if (sm?.risk === "Medium" && sm.riskWhy.length) whyNot.push("Some manipulation risk (thin trading, small size or a stretched run-up).");
    if (mc?.verdict === "negative") whyNot.push("The economic and policy backdrop is negative.");
    if (o.live && (o.live.status === "above-zone" || o.live.status === "target-hit")) whyNot.push("Today's price has already moved above the buy range.");
    if (hist && hist.trades >= 10 && ((hist.winRatePct ?? 0) < 40 || (hist.avgNetPct ?? 0) < 0)) whyNot.push(`This setup type has a poor record: ${Math.round(hist.winRatePct ?? 0)}% of ${hist.trades} past trades were profitable (average ${r1(hist.avgNetPct ?? 0)}% after costs).`);
    const poorRecord = !!hist && hist.trades >= 10 && ((hist.winRatePct ?? 0) < 40 || (hist.avgNetPct ?? 0) < 0);
    if (whyNot.length >= 2 || bizBad || newsBad || poorRecord || !!sm?.blocksBuy) { decision = "WATCH"; headline = `The chart gives a buy setup, but ${whyNot.join(" ").toLowerCase()} Wait until this clears.`; }
    else if (whyNot.length === 1) { decision = "BUY"; headline = `Buy setup (${o.setupType}), with one caution: ${whyNot[0].toLowerCase()} Use a smaller position.`; }
    else if (agree.positive >= 5 && sm?.verdict !== "negative" && sm?.risk !== "Medium" && (!hist || hist.trades < 10 || (hist.winRatePct ?? 0) >= 45)) { decision = "STRONG BUY"; headline = `Strong buy: the ${o.setupType?.toLowerCase()} setup is backed by the business, the reports, the news, smart money and the market.`; }
    else { decision = "BUY"; headline = `Buy: ${o.setupType?.toLowerCase()} setup in the entry zone, nothing major against it.`; }
  } else if (o.action === "HOLD") {
    if (sm && (sm.phase === "Distribution" || sm.risk === "High" || sm.brokerRead === "Distribution")) { decision = "HOLD"; headline = sm.risk === "High" ? "Hold only with a tight stop: signs of operator activity. Consider booking part of any profit; do not add." : sm.phase === "Distribution" ? "Hold, but large holders appear to be selling (distribution in price and volume). Consider booking part of the profit; do not add." : "Hold, do not add yet: the business is fine but big brokers have been net sellers in recent sessions. Add only once their selling stops."; }
    else if (bizGood && repGood && !newsBad && !mktBad && sm?.verdict !== "negative" && o.supports.some((s) => price != null && s > price * 0.93)) { decision = "ACCUMULATE"; horizon = "6-12 months (investment)"; headline = "Sound business in an uptrend near support: suitable to accumulate gradually for the long term." + `${sm?.brokerRead === "Accumulation" || sm?.phase === "Accumulation" ? " Large players also appear to be accumulating." : ""}` ; }
    else { decision = "HOLD"; headline = `Hold if you own it: ${o.headline.replace(/^Hold: /, "")}`; }
  } else {
    // WATCH from the chart
    if (bizGood && repGood && !newsBad && P("chart").verdict !== "negative" && o.indicators.trend !== "downtrend" && o.entryLow != null) { decision = "WATCH"; headline = `Good business; wait for ${o.waitFor ?? "the entry condition"} before buying.`; }
    else if (bizBad && o.indicators.trend === "downtrend") { decision = "AVOID"; headline = "Weak business in a downtrend: avoid."; }
    else { decision = "WATCH"; headline = o.headline; }
  }
  if (decision === "SELL" || decision === "REDUCE") horizon = "Now";
  if (decision === "ACCUMULATE") horizon = "6-12 months (investment)";

  let conviction: Research["conviction"] = decision === "NO CALL" ? "Low" : agree.known >= 5 && (agree.positive >= 5 || agree.negative >= 4) ? "High" : agree.known >= 4 && Math.abs(agree.positive - agree.negative) >= 2 ? "Medium" : "Low";
  if (sm?.risk === "High" && conviction === "High" && (decision === "BUY" || decision === "STRONG BUY" || decision === "ACCUMULATE")) conviction = "Medium";
  const tone: Research["tone"] = decision === "STRONG BUY" || decision === "BUY" || decision === "ACCUMULATE" ? "up" : decision === "SELL" || decision === "AVOID" || decision === "REDUCE" ? "down" : decision === "WATCH" ? "warn" : "blue";

  // The plan in plain words.
  const t = o.targets;
  const trade = decision === "STRONG BUY" || decision === "BUY" || (decision === "WATCH" && o.entryLow != null);
  const above = price != null ? o.resistances.filter((x) => x > price * 1.01).slice(0, 3) : [];
  const deepSup = price != null ? o.supports.filter((x) => x < price * 0.99) : [];
  const ltStop = o.indicators.sma200 != null && price != null && o.indicators.sma200 < price ? Math.round(o.indicators.sma200 * 0.97 * 100) / 100 : deepSup.length ? Math.round(deepSup[deepSup.length - 1] * 0.98 * 100) / 100 : null;
  const plan: Research["plan"] = {
    entry: decision === "STRONG BUY" || decision === "BUY" ? (o.entryLow != null ? `Buy between ${rs(o.entryLow)} and ${rs(o.entryHigh ?? o.entryLow)}${o.buyNow === "wait" && o.waitFor ? `, after ${o.waitFor}` : ""}. Do not chase above ${rs((o.entryHigh ?? o.entryLow) * 1.01)}.` : null)
      : decision === "ACCUMULATE" ? `Buy in parts near support${deepSup.length ? ` (${deepSup.slice(0, 2).map(rs).join(", ")})` : ""}, not all at once.`
      : decision === "WATCH" && o.entryLow != null ? `Only buy in ${rs(o.entryLow)}-${rs(o.entryHigh ?? o.entryLow)} once ${o.waitFor ?? "the condition is met"}.` : null,
    stop: decision === "ACCUMULATE" ? (ltStop != null ? `${rs(ltStop)} for a long-term holding (below the 200-day average / major support): exit on a weekly close below it.` : null)
      : o.stop != null ? `${rs(o.stop)}: exit on a daily close below it.` : null,
    targets: trade ? t.map((x, i) => `Target ${i + 1}: ${rs(x.price)} (${x.basis.toLowerCase()})`) : above.map((x, i) => `Sell zone ${i + 1}: ${rs(x)} (resistance)`),
    exit: trade ? [
      ...(t[0] ? [`Book about a third at ${rs(t[0].price)}, then move the stop to your entry price.`] : []),
      ...(t[1] ? [`Book more at ${rs(t[1].price)}; let the rest run with a trailing stop.`] : []),
      ...(o.reviewBy ? [`Review by ${o.reviewBy}: if the price has not moved toward target 1, close the trade (time stop).`] : []),
    ] : decision === "ACCUMULATE" ? ["Review each quarter when results come out: keep accumulating while the business stays sound and the price holds above the stop."]
      : decision === "SELL" || decision === "REDUCE" ? [decision === "SELL" ? "Exit now or on the next bounce; do not buy more." : "Sell part now; keep the rest only with the stop."] : [],
    size: trade && o.stop != null && o.entry != null && o.entry > o.stop ? `Risk at most 1-2% of your trading money: with Rs. 1,00,000, risking 1% (Rs. 1,000) means about ${Math.floor(1000 / (o.entry - o.stop))} shares at this stop.` : null,
  };
  const changeMind = decision === "ACCUMULATE" ? [ltStop != null ? `A weekly close below ${rs(ltStop)}.` : "A break below major support.", "Weaker quarterly results, new red flags or negative news."] : [...o.invalidation.slice(0, 3)];
  if (decision === "WATCH" && whyNot.length) changeMind.unshift("A buy becomes valid once the cautions above clear and the price is in the zone.");
  if (sm && (decision === "BUY" || decision === "STRONG BUY" || decision === "ACCUMULATE" || decision === "HOLD")) changeMind.push("Big brokers turning into net sellers, or a sharp run-up on unusual volume (signs of distribution or a pump).");
  if (mc) changeMind.push("A tighter NRB monetary policy, higher interest rates, adverse budget measures or political unrest.");
  return { symbol: inp.symbol, name: inp.name, sector: inp.sector, asOf: o.priceDate, price, decision, tone, conviction, headline: headline + (decision === "STRONG BUY" || decision === "BUY" ? tr : ""), horizon, pillars, agree, plan, whyNot, changeMind, smart: sm, macroSummary: mc ? { verdict: mc.verdict, summary: mc.summary, asOf: mc.asOf } : null };
}
