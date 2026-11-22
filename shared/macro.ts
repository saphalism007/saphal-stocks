// Economy, policy and politics: the backdrop every NEPSE stock trades in. Built only from stored official data
// (NRB's monthly macroeconomic report and policy rates) and stored news headlines (ShareSansar news, which covers
// Nepal politics, the economy, policy, India and international news). Nothing is invented: each point names its figure
// and date, and headlines are shown so you can read them yourself. Headline tone is keyword-based, so it is a guide,
// not a reading of the full article.

export interface MacroReport { title: string; published: string; inflation: number | null; highlights: string[]; url: string }
export interface MacroNews { date: string | null; title: string; url: string | null }
export interface MacroInput { reports: MacroReport[]; policyRate: { value: number; asOf: string; prev: number | null; prevAsOf: string | null } | null; news: MacroNews[]; today: string }

export type Theme = "Politics" | "Policy" | "Economy" | "India and world" | "Market";
export interface TaggedNews extends MacroNews { theme: Theme; tone: "positive" | "negative" | "neutral"; sectors: string[] }
export interface MacroPoint { label: string; value: string; effect: "positive" | "negative" | "neutral"; why: string }
export interface Macro {
  verdict: "positive" | "neutral" | "negative" | "unknown"; score: number | null; summary: string;
  points: MacroPoint[]; news: TaggedNews[]; newsTone: { positive: number; negative: number };
  calendar: string[]; asOf: string | null; source: string | null;
  sectorNotes: Record<string, string[]>;
}

const num = (s: string, re: RegExp, i = 1) => { const m = s.match(re); return m ? Number(m[i]) : null; };
const pick = (hs: string[], re: RegExp, i = 1) => { for (const h of hs) { const v = num(h, re, i); if (v != null && Number.isFinite(v)) return v; } return null; };

function parseReport(r: MacroReport) {
  const h = r.highlights;
  return {
    inflation: r.inflation ?? pick(h, /inflation remained at ([\d.]+)/i),
    lending: pick(h, /lending rate stood at ([\d.]+)/i),
    deposit: pick(h, /deposit rate of commercial banks stood at ([\d.]+)/i),
    interbank: pick(h, /inter-?bank rate[^.]*?stood at ([\d.]+)/i),
    depositYoy: pick(h, /y-o-y basis, deposits increased by ([\d.]+)/i),
    creditYoy: pick(h, /y-o-y basis, deposits increased by [\d.]+ percent and private sector credit increased by ([\d.]+)/i),
    remit: pick(h, /Remittances increased ([\d.]+) percent in NPR/i),
    reserveMonths: pick(h, /imports of ([\d.]+) months/i),
    bop: pick(h, /balance of payments remained at a surplus of Rs\.? ?([\d.]+)/i),
  };
}

const THEMES: [Theme, RegExp][] = [
  ["Policy", /\b(NRB|Nepal Rastra Bank|monetary|policy rate|interest rate|CRR|SLR|margin lend|loan[- ]to[- ]value|SEBON|capital gain|CGT|tax|budget|finance minist|directive|regulat|circuit|Act amendment|Electricity Act|licen[cs]e)\b/i],
  ["Politics", /\b(Prime Minister|PM |minister|cabinet|government|parliament|election|party|coalition|protest|strike|bandh|resign|president|political|Balen|Gen ?Z)\b/i],
  ["India and world", /\b(India|Indian|China|Chinese|US |U\.S\.|America|Fed\b|Federal Reserve|global (market|economy|oil|stock)|world (economy|market)|international|oil price|crude|war|tariff|Nasdaq|Dow|Sensex|Nifty|Bangladesh|Pakistan|IMF|World Bank|ADB)\b/i],
  ["Economy", /\b(remittance|inflation|reserve|GDP|economic|economy|revenue|export|import|trade deficit|balance of payments|liquidity|deposit|credit|treasury|T-bill|tourist|mountaineering)\b/i],
  ["Market", /\b(NEPSE|index|turnover|share market|stock market|sector)\b/i],
];
const POS = /\b(approv|increas|grow|surplus|record|extend|relief|cuts?\b|lower(s|ed)? (the )?(rate|tax)|eas(e|es|ing)\b|boost|rise[sn]?\b|rose\b|jump|surge|gain|recover|improv|reform|agreement|interest[- ]free loan|investment|strong|sufficient)/i;
const NEG = /\b(declin|decreas|fall|fell\b|slump|slid|drop|plung|crash|protest|strike|bandh|bans?\b|penalt|tighten|hike|raise[sd]? (tax|rate)|crisis|unrest|violen|resign|deficit|default|loss|weak|shortage|sanction|war\b|conflict|uncertain|collaps)/i;
const SECTOR_WORDS: [string, RegExp][] = [
  ["Hydropower", /\b(hydro|hydropower|electricity|power purchase|PPA|energy)\b/i],
  ["Commercial Bank", /\b(bank|banks|banking|NRB|interest rate|loan|credit|deposit)\b/i],
  ["Development Bank", /\b(development bank|bank|banks|NRB|interest rate|loan|credit)\b/i],
  ["Finance", /\b(finance compan|NRB|interest rate|loan|credit)\b/i],
  ["Microfinance", /\b(microfinance|laghubitta|NRB)\b/i],
  ["Life Insurance", /\b(insurance|Nepal Insurance Authority|NIA)\b/i],
  ["Non-Life Insurance", /\b(insurance|Nepal Insurance Authority|NIA)\b/i],
  ["Hotel & Tourism", /\b(tourism|tourist|hotel|mountaineering|airline|visit)\b/i],
  ["Manufacturing and Processing", /\b(industr|manufactur|cement|import|export)\b/i],
  ["Trading", /\b(import|export|trade)\b/i],
];

export function tagNews(n: MacroNews): TaggedNews | null {
  const t = n.title;
  const theme = THEMES.find(([, re]) => re.test(t))?.[0];
  if (!theme) return null;
  // Company-specific dividend / AGM / CEO items are covered in each stock's own news, not the economy.
  if (/\b(dividend|book closure|AGM|SGM|IPO|FPO|right shares?|unit issue|auction|debenture|CEO|chief executive|launches|scheme|sponsor|courtesy call|construction of new|branch)\b/i.test(t) && !/\b(NRB|monetary|tax|budget|policy rate|margin lend|directive)\b/i.test(t)) return null;
  const p = POS.test(t), ng = NEG.test(t);
  return { ...n, theme, tone: p && !ng ? "positive" : ng && !p ? "negative" : "neutral", sectors: SECTOR_WORDS.filter(([, re]) => re.test(t)).map(([s]) => s) };
}

export function macro(inp: MacroInput): Macro {
  const points: MacroPoint[] = [];
  const sectorNotes: Record<string, string[]> = {};
  const note = (s: string, x: string) => { (sectorNotes[s] ??= []).push(x); };
  const [cur, prev] = inp.reports;
  let pts = 0;
  if (cur) {
    const a = parseReport(cur), p = prev ? parseReport(prev) : null;
    const asOf = cur.title.includes("(") ? cur.title.slice(cur.title.indexOf("(") + 1, cur.title.lastIndexOf(")")).trim() : cur.published;
    if (a.lending != null) {
      const fall = p?.lending != null ? a.lending < p.lending : null;
      const eff = a.lending <= 9 || fall ? "positive" : a.lending >= 11 ? "negative" : "neutral";
      pts += eff === "positive" ? 1 : eff === "negative" ? -1 : 0;
      points.push({ label: "Bank lending rate", value: `${a.lending}%${p?.lending != null ? ` (was ${p.lending}%)` : ""}`, effect: eff, why: eff === "positive" ? "Cheap and falling loan rates have historically pushed money into NEPSE (margin loans get cheaper, deposits pay less)." : eff === "negative" ? "High loan rates pull money out of shares and into deposits." : "Loan rates are moderate." });
    }
    if (a.interbank != null) {
      const eff = a.interbank <= 3.5 ? "positive" : a.interbank >= 6 ? "negative" : "neutral";
      pts += eff === "positive" ? 1 : eff === "negative" ? -1 : 0;
      points.push({ label: "Interbank rate", value: `${a.interbank}%`, effect: eff, why: eff === "positive" ? "Banks have plenty of spare cash (excess liquidity), which usually supports share prices." : eff === "negative" ? "Banks are short of cash; liquidity is tight, which usually weighs on shares." : "Liquidity is normal." });
    }
    if (a.depositYoy != null && a.creditYoy != null) {
      const gap = a.depositYoy - a.creditYoy;
      points.push({ label: "Deposits vs loans (yearly growth)", value: `deposits +${a.depositYoy}%, private credit +${a.creditYoy}%`, effect: gap >= 3 ? "positive" : gap <= -3 ? "negative" : "neutral", why: gap >= 3 ? "Deposits are growing faster than loans: money is piling up in banks, keeping rates low (good for the market), though weak loan demand squeezes bank margins." : gap <= -3 ? "Loans are growing faster than deposits: liquidity may tighten and rates may rise." : "Deposits and loans are growing at a similar pace." });
      if (gap >= 3) { pts += 0.5; for (const s of ["Commercial Bank", "Development Bank", "Finance", "Microfinance"]) note(s, `Banks: credit growth (${a.creditYoy}%) lags deposit growth (${a.depositYoy}%) and lending rates are low, which squeezes interest margins; watch each bank's net interest income and NPL in its quarterly report.`); }
    }
    if (a.remit != null) { const eff = a.remit >= 10 ? "positive" : a.remit < 0 ? "negative" : "neutral"; pts += eff === "positive" ? 0.5 : eff === "negative" ? -0.5 : 0; points.push({ label: "Remittances", value: `+${a.remit}% (NPR)`, effect: eff, why: eff === "positive" ? "Strong remittances add deposits and spending power; a large part of NEPSE money comes from this." : "Remittance growth is weak." }); }
    if (a.reserveMonths != null) { const eff = a.reserveMonths >= 7 ? "positive" : a.reserveMonths < 5 ? "negative" : "neutral"; points.push({ label: "Foreign exchange reserves", value: `${a.reserveMonths} months of imports`, effect: eff, why: eff === "positive" ? "Comfortable reserves: no pressure on NRB to tighten money." : eff === "negative" ? "Low reserves often force NRB to restrict credit, which hurts shares." : "Adequate reserves." }); if (eff === "negative") pts -= 1; }
    if (a.inflation != null) { const eff = a.inflation <= 5.5 ? "positive" : a.inflation >= 7 ? "negative" : "neutral"; pts += eff === "positive" ? 0.5 : eff === "negative" ? -1 : 0; points.push({ label: "Inflation", value: `${a.inflation}%${p?.inflation != null ? ` (was ${p.inflation}%)` : ""}`, effect: eff, why: eff === "positive" ? "Low inflation leaves NRB room to keep rates low." : eff === "negative" ? "High inflation can push NRB to raise rates or tighten lending." : "Inflation is a little above NRB's comfort level; a rate cut is less likely but no tightening is signalled." }); }
    points.forEach((x) => { x.why += ` Source: NRB report, ${asOf}.`; });
  }
  if (inp.policyRate) {
    const pr = inp.policyRate, cut = pr.prev != null && pr.value < pr.prev, hike = pr.prev != null && pr.value > pr.prev;
    pts += cut ? 1 : hike ? -1 : 0;
    points.push({ label: "NRB policy rate", value: `${pr.value}% since ${pr.asOf}${pr.prev != null ? ` (was ${pr.prev}%)` : ""}`, effect: cut ? "positive" : hike ? "negative" : "neutral", why: cut ? "The last change was a cut: easier money." : hike ? "The last change was a hike: tighter money." : "Unchanged." });
  }
  // Headlines of the last 21 days.
  const recent = inp.news.filter((n) => !n.date || (Date.parse(inp.today) - Date.parse(n.date)) / 86_400_000 <= 21);
  const tagged = recent.map(tagNews).filter((x): x is TaggedNews => !!x);
  const tone = { positive: tagged.filter((x) => x.tone === "positive" && x.theme !== "Market").length, negative: tagged.filter((x) => x.tone === "negative" && x.theme !== "Market").length };
  if (tone.negative >= tone.positive + 3) pts -= 1; else if (tone.positive >= tone.negative + 3) pts += 0.5;
  for (const x of tagged) for (const s of x.sectors) if (x.theme !== "Market") note(s, `${x.tone === "positive" ? "Supportive" : x.tone === "negative" ? "Negative" : "Relevant"} news: ${x.title}${x.date ? ` (${x.date})` : ""}`);
  const calendar = [
    "Federal budget speech: Jestha 15 every year (constitutional date). Changes to capital gains tax, bank and sector rules usually come here; markets often move in the weeks before.",
    "NRB monetary policy: announced around Shrawan each year, with a mid-term review around Magh-Falgun. Changes to margin lending, interest rate corridors and bank capital rules move bank and finance stocks most.",
    "Quarterly results: due within 30 days of each quarter end (Kartik, Magh, Baisakh, Shrawan); bank results move the whole index.",
  ];
  const known = !!cur || !!inp.policyRate || tagged.length > 0;
  const verdict: Macro["verdict"] = !known ? "unknown" : pts >= 2 ? "positive" : pts <= -1.5 ? "negative" : "neutral";
  const summary = !known ? "No economic data stored." : verdict === "positive" ? "Liquidity and the economy are supportive for shares." : verdict === "negative" ? "The economic and policy backdrop is working against shares." : "The economic backdrop is mixed.";
  return { verdict, score: known ? Math.max(0, Math.min(100, Math.round(50 + pts * 10))) : null, summary, points, news: tagged.slice(0, 30), newsTone: tone, calendar, asOf: cur?.published ?? null, source: cur?.url ?? null, sectorNotes };
}
