/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.10.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Start Investing: open the right accounts once (bank, Demat, Mero Share, C-ASBA, broker), then follow a path by amount, from Rs. 500 a month to Rs. 1 lakh+, with a direct official link for every step, checked daily.",
  "NEPSE Market home: turnover vs the previous session, market leaders, dividend/bonus and AGM disclosures, a sector heatmap (1D/1W/1M/1Y) and movers including results.",
  "Technical Signals: breadth against the 20/50/200-day averages and 22 signals (RSI, MACD, crosses, VWAP, breakouts, volume, circuit) with counts and every stock's signals.",
  "Quarterly Results: every company's latest quarter against the same quarter last year, with ups, downs and the biggest movers.",
  "IPO & FPO: open, upcoming and recent listings with gains, apply and allotment links, reminders and your saved BOIDs. Floorsheet: every trade by stock and by broker, plus a Brokers tab on each stock.",
  "Chart Terminal with ranges, log scale, indicators and drawing tools (trendline, horizontal line, Fibonacci) saved per stock; plain-language pros and cons on each stock; company cards with sector chips.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
