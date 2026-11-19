/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.26.0";
export const RELEASED = "2026-11-19";
export const NOTES = [
  "Chart Terminal: 1m, 5m, 15m, 30m and 1h candles now work. The live relay records every stock's traded price about once a minute in market hours (from 19 Nov 2026), and the chart builds the candles from that record, with Nepal time on the axis. Prices are sampled once a minute, so a spike between two samples may be missing from intraday candles.",
  "Today's daily candle: the high and low are ShareSansar's own figures for today (the page's date is checked), widened by any price the relay recorded beyond them. The official close data replaces the candle each evening.",
  "Portfolio, What to do next: every stock you hold gets one clear action (Hold, Add, Book profit, Reduce, Sell or Review), your break-even, a stop-loss, sell zones with the net profit at each, where to add more (with your new WACC), and numbered next steps. Stocks you sold get a buy-back view.",
  "News on your stocks: the last 45 days of announcements, results and dividends for everything you hold or sold, each opening the full story or the company page.",
  "Your position on every stock page: open a stock you hold and your plan appears at the top.",
  "Signals no longer change during the day: buy and sell signals are set on the last official close and recalculated once after each close. A new Live now column shows whether the entry is still available at today's price, and each signal shows since when it has stood.",
  "Trading Opportunities: each stock's plan now links to its full company page and chart.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
