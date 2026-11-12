// Smart search: understands symbols, any word of a company name, initials, small typos, sectors,
// app features ("gold", "SIP", "FD rates") and intents ("nabil chart", "nabil dividend"). Pure; tested.

export interface Co { symbol: string; name: string; sector: string | null; status?: string | null }
export interface StockHit extends Co { score: number; why: string }

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["limited", "ltd", "company", "co", "the", "of", "and", "nepal", "pvt", "public"]);

export function lev(a: string, b: string, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Words that change where a stock result goes: "nabil chart", "nicasia dividend". */
export const INTENTS: { re: RegExp; label: string; path: (s: string) => string }[] = [
  { re: /\b(chart|terminal|candle|technical|ta|buy|sell|signal|should i|target|stop ?loss|support|resistance)\b/, label: "Chart & AI signal", path: (s) => `/terminal/${s}` },
  { re: /\b(dividend|bonus|cash dividend|book close)\b/, label: "Dividends", path: (s) => `/stocks/${s}?tab=dividends` },
  { re: /\b(quarter|quarterly|q[1-4]|result|results|earning|earnings|profit)\b/, label: "Quarterly reports", path: (s) => `/stocks/${s}?tab=quarterly` },
  { re: /\b(annual|audit|audited)\b/, label: "Annual & audit reports", path: (s) => `/stocks/${s}?tab=annual` },
  { re: /\b(news|notice|agm|announcement)\b/, label: "News & notices", path: (s) => `/stocks/${s}?tab=notices` },
  { re: /\b(fundamental|fundamentals|pe|p e|eps|roe|book value|valuation)\b/, label: "Fundamentals", path: (s) => `/stocks/${s}?tab=fundamentals` },
  { re: /\b(broker|brokers|floorsheet)\b/, label: "Brokers", path: (s) => `/stocks/${s}?tab=brokers` },
  { re: /\b(backtest|back test)\b/, label: "Backtest", path: (s) => `/stocks/${s}?tab=backtest` },
];

export function splitIntent(q: string) {
  let rest = norm(q), intent: (typeof INTENTS)[number] | null = null;
  for (const it of INTENTS) if (it.re.test(rest)) { intent = it; rest = rest.replace(it.re, " ").replace(/\s+/g, " ").trim(); break; }
  return { rest, intent };
}

export function searchStocks(qRaw: string, cos: Co[], limit = 8): StockHit[] {
  const q = norm(qRaw); if (!q) return [];
  const qs = q.replace(/ /g, ""), words = q.split(" ").filter((w) => w && !STOP.has(w));
  const out: StockHit[] = [];
  for (const c of cos) {
    const sym = c.symbol.toLowerCase(), name = norm(c.name || ""), nw = name.split(" ").filter((w) => !STOP.has(w));
    const initials = nw.map((w) => w[0]).join("");
    let score = 0, why = "";
    const set = (s: number, w: string) => { if (s > score) { score = s; why = w; } };
    if (sym === qs) set(100, "symbol");
    else if (sym.startsWith(qs)) set(85 - Math.min(10, sym.length - qs.length), "symbol");
    if (name === q) set(95, "name");
    if (name.startsWith(q)) set(80, "name");
    if (words.length && words.every((w) => nw.some((x) => x.startsWith(w)))) set(70 + Math.min(8, words.length * 2), "name");
    if (qs.length >= 2 && initials.startsWith(qs)) set(62, "initials");
    if (qs.length >= 2 && sym.includes(qs)) set(55, "symbol");
    if (q.length >= 3 && name.includes(q)) set(50, "name");
    if (!score && qs.length >= 3 && qs[0] === sym[0]) { let k = 0; for (const ch of sym) if (ch === qs[k]) k++; if (k === qs.length) set(48, "close spelling"); }
    if (!score && qs.length >= 3) {
      const d = lev(qs, sym, 1); if (d <= 1) set(42, "close spelling");
      if (qs.length >= 4) for (const w of nw) { const d2 = lev(words[0] ?? qs, w, qs.length >= 7 ? 2 : 1); if (d2 <= (qs.length >= 7 ? 2 : 1)) { set(38, "close spelling"); break; } }
    }
    if (score) {
      if (c.status && c.status !== "active") score -= 25;
      if (/promoter|debenture/i.test(c.sector ?? "")) score -= 8;
      out.push({ ...c, score, why });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol)).slice(0, limit);
}

const SECTOR_ALIAS: Record<string, string[]> = {
  "Hydropower": ["hydro", "hydropower", "power", "electricity", "energy"], "Commercial Bank": ["bank", "banks", "commercial bank", "banking"],
  "Development Bank": ["development bank", "dev bank", "bikas"], "Finance": ["finance", "finance company"], "Microfinance": ["microfinance", "laghubitta", "micro"],
  "Life Insurance": ["life insurance", "insurance", "bima"], "Non-Life Insurance": ["non life", "nonlife", "insurance", "general insurance"],
  "Hotels And Tourism": ["hotel", "hotels", "tourism"], "Manufacturing And Processing": ["manufacturing", "processing", "industry"],
  "Mutual Fund": ["mutual fund", "mf", "fund", "funds"], "Investment": ["investment", "holding"], "Trading": ["trading"], "Others": ["others"],
  "Corporate Debentures": ["debenture", "debentures", "bond", "bonds"],
};
export function searchSectors(qRaw: string, sectors: string[]) {
  const q = norm(qRaw); if (q.length < 3) return [];
  return sectors.filter((s) => { const n = norm(s); return n.includes(q) || (SECTOR_ALIAS[s] ?? []).some((a) => a.startsWith(q) || q.startsWith(a)); }).slice(0, 3);
}

/** App features with the words people use for them. */
export const FEATURES: { label: string; to: string; words: string }[] = [
  { label: "Gold & silver prices", to: "/invest?tab=metals", words: "gold silver sun chandi tola fenegosida bullion precious metal" },
  { label: "Build my investment plan", to: "/invest", words: "plan invest where should i invest diversify portfolio allocation sip monthly saving rich wealth" },
  { label: "Fixed deposit rates by bank", to: "/invest?tab=deposits", words: "fd fixed deposit interest rate bank rates recurring rd saving account deposit" },
  { label: "NRB rates & inflation", to: "/invest?tab=rates", words: "nrb inflation policy rate interest rates t bill treasury base rate cpi" },
  { label: "Mutual funds, SIP, debentures & bonds", to: "/invest?tab=funds", words: "mutual fund sip nav debenture bond government bond closed end open ended" },
  { label: "Prepay a loan or invest?", to: "/invest?tab=loan", words: "loan emi prepay home loan debt" },
  { label: "All investment channels in Nepal", to: "/future", words: "ways to invest channels options land property cit ssf epf insurance cooperative business long term" },
  { label: "My Growth: today's to-do", to: "/growth", words: "today todo to do growth action what should i do morning briefing" },
  { label: "Holdings plan (stop, target, action for each share)", to: "/growth?tab=holdings", words: "holdings plan portfolio health stop target trim rebalance sell tax cgt" },
  { label: "Discipline coach & pre-buy checklist", to: "/growth?tab=coach", words: "coach discipline checklist habits mistakes position size risk psychology" },
  { label: "Dividends & events calendar", to: "/growth?tab=calendar", words: "calendar dividend book close agm bonus events dates income" },
  { label: "Chart terminal", to: "/terminal", words: "chart terminal candlestick trendline drawing indicators tradingview" },
  { label: "Indicator Guide (100 indicators)", to: "/indicators", words: "indicator guide learn indicators rsi macd bollinger bands ema sma moving average ichimoku supertrend adx stochastic obv vwap atr fibonacci parabolic sar keltner donchian alligator fractals money flow mfi cmf williams cci aroon vortex hull kama t3 mcginley schaff connors laguerre how to read buy signal sell signal" },
  { label: "Before the bell (morning news)", to: "/", words: "before the bell morning news pre-open preopen announcements today market open close summary 11 am briefing" },
  { label: "Trading opportunities (buy setups)", to: "/trading", words: "buy setups trading opportunities swing breakout signals what to buy" },
  { label: "Technical signals", to: "/signals", words: "technical signals rsi macd golden cross oversold overbought" },
  { label: "Quarterly results", to: "/results", words: "quarterly result earnings profit eps q1 q2 q3 q4" },
  { label: "Annual & audit reports", to: "/reports", words: "annual report audit audited financial statement" },
  { label: "IPO & FPO (apply, results)", to: "/ipo", words: "ipo fpo right share apply result allotment meroshare open issue" },
  { label: "Floorsheet & brokers", to: "/floorsheet", words: "floorsheet broker buyer seller accumulation" },
  { label: "NEPSE market today", to: "/market", words: "nepse index market today gainers losers turnover sector index top" },
  { label: "Market monitor", to: "/monitor", words: "monitor live watch market breadth" },
  { label: "Financial news", to: "/news", words: "news notice announcement agm book close" },
  { label: "Fundamentals screener", to: "/fundamental", words: "fundamentals screener pe pb roe eps book value undervalued" },
  { label: "Compare stocks", to: "/compare", words: "compare vs versus" },
  { label: "Strategy lab (backtest)", to: "/strategy-lab", words: "backtest strategy test" },
  { label: "My portfolio", to: "/portfolio", words: "portfolio holdings my shares profit loss wacc" },
  { label: "Watchlist", to: "/watchlist", words: "watchlist favourites follow" },
  { label: "Trading journal", to: "/journal", words: "journal thesis diary trades log" },
  { label: "Wealth management (income, spending, net worth)", to: "/money", words: "money budget expense income net worth emergency fund spending salary" },
  { label: "Loan & EMI planner (amortisation schedule)", to: "/loan", words: "loan emi amortisation amortization schedule home loan car loan installment instalment interest principal prepayment floating rate buy cash or loan" },
  { label: "Mutual funds: every fund with apply links", to: "/directory", words: "mutual fund funds sip open ended close ended nav apply fund manager units invest monthly" },
  { label: "Stockbrokers list (all licensed brokers)", to: "/directory?tab=brokers", words: "broker brokers stockbroker list tms open account contact phone sebon" },
  { label: "Broker activity (who is buying/selling)", to: "/directory?tab=activity", words: "broker activity accumulation smart money buying selling broker number" },
  { label: "Invest or trade? Best stocks", to: "/picks", words: "best stocks strong fundamentally strong technically strong invest trade top stocks which stock to buy long term short term sector wise" },
  { label: "Purchase planner (save for a TV, bike, phone...)", to: "/purchases", words: "purchase buy save for tv ps5 phone laptop bike car wedding festival dashain tihar sinking fund pot emi big purchase" },
  { label: "Market mood (fear & greed)", to: "/discover", words: "mood fear greed sentiment market mood emotion panic euphoria" },
  { label: "Stock baskets (ready-made portfolios)", to: "/discover?tab=baskets", words: "basket baskets smallcase theme portfolio ready made dividend payers momentum value banks hydropower quality" },
  { label: "Money calculators", to: "/calculators", words: "calculator calculators tax income tax salary tds sip step up lumpsum goal retirement cagr real return average wacc bonus right debenture yield rent buy home loan emi affordability gold making charge" },
  { label: "Income tax calculator 2083/84", to: "/calculators#income-tax", words: "income tax salary tax tds ssf cit slab 2083 84 rebate" },
  { label: "Which investment is best?", to: "/invest?tab=best", words: "best return compare which investment highest return safe" },
  { label: "Wealth roadmap", to: "/growth?tab=roadmap", words: "roadmap guide steps wealth plan financial freedom how to get rich" },
  { label: "Goals & planning", to: "/planner", words: "goal planner car purchase net worth allocation profile" },
  { label: "Start investing (beginner guide)", to: "/start", words: "start beginner how to demat meroshare tms account" },
  { label: "Investment directory", to: "/opportunities", words: "directory products cit ssf pf insurance" },
  { label: "Alerts", to: "/alerts", words: "alert notify notification price alert" },
  { label: "Learning centre", to: "/learn", words: "learn course lesson guide education" },
  { label: "AI analyst chat", to: "/analyst", words: "ai ask analyst chat claude question" },
  { label: "Settings & data", to: "/settings", words: "settings data refresh api key update version" },
];
export function searchFeatures(qRaw: string, limit = 4) {
  const q = norm(qRaw); if (q.length < 2) return [];
  const words = q.split(" ");
  return FEATURES.map((f) => {
    const hay = norm(`${f.label} ${f.words}`), hw = hay.split(" ");
    let s = 0;
    if (norm(f.label).startsWith(q)) s = 90;
    else if (words.every((w) => hw.some((x) => x.startsWith(w)))) s = 70;
    else if (words.some((w) => w.length >= 3 && hw.some((x) => x.startsWith(w)))) s = 40;
    else if (q.length >= 4 && words.some((w) => hw.some((x) => x.length >= 4 && lev(w, x, 1) <= 1))) s = 30;
    return { ...f, score: s };
  }).filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
