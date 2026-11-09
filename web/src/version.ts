/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.16.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "NEPSE Market Mood (new Discover page): a 0–100 fear & greed gauge built from six market readings (rising vs falling stocks, stocks above their 50-day average, 52-week highs vs lows, NEPSE vs its 125-day average, turnover and RSI), with its history and what it means for you.",
  "Stock baskets: ready-made themes — quality compounders, steady dividend payers, value picks, momentum leaders, strong banks, hydropower leaders and low-volatility shares — with members, 3-month and 1-year returns vs NEPSE, and one tap to add them to your watchlist.",
  "Stock scorecard in the ⚡ signal: a six-point shape (value, growth, profitability, financial health, dividends, momentum) and the likely price range for next week and next month from recent price swings.",
  "Your true yearly return (XIRR) in My Growth → Holdings plan: counts when you invested, fees, sales and dividends.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
