/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.28.0";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Research verdict before every recommendation: each stock is studied in six areas (chart setup, all 100 indicators, business and valuation, quarterly and audit reports, news and events, market and sector), each with its reasons. The final decision (Strong buy, Buy, Accumulate, Watch, Hold, Reduce, Sell, Avoid) needs these to agree: a chart buy with a weak business, negative news, a falling market or a losing track record is held back, and the app says why.",
  "Each verdict gives when to buy, the stop-loss, targets and when to sell, a position size, and what would change the view. Long-term Accumulate calls use a long-term stop.",
  "Trading Opportunities: Final research picks at the top (buy, accumulate, sell or reduce), a Research column, and the full research in every stock's plan. Stock pages show the research verdict near the top.",
  "Portfolio: each holding shows its research verdict; a plan never says add more when the research says reduce, sell or avoid.",
  "Fixed: NTC's P/E and book value were 1,000 times off because its report mixes units; per-share figures are now checked against the company's reported EPS.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
