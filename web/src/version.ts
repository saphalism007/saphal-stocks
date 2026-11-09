/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.9.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Trading Opportunities: every listed stock classified BUY, SELL, HOLD, WATCH or AVOID (or insufficient data), with buy range, stop-loss, three targets, reward/risk before and after all costs, holding period, reasons, indicators, invalidation, confidence and a review date.",
  "Honest track record: the BUY rule replayed on the past year with fees and tax, plus a live log of each day's signals judged against later prices. Confidence is capped when a setup type has lost money.",
  "Trade planner: shares to buy from your capital and risk per trade, exact charges, CGT, net profit or loss at each target and the stop; paper-trade a signal and set buy-range, target and stop alerts in one tap.",
  "Invest for the Future: what Rs. 500–5,000 a month can grow to over 1–20 years (stated assumptions), every Nepal option with how to start and a checked official link, provider websites and long-term stock ideas.",
  "Wealth Management: allocation chart, net worth history, this month vs your savings target, portfolio returns, goal progress and a debt payoff planner. Investment Planner compares conservative, balanced and growth portfolios.",
  "New alerts: buying range reached, major support broken, mutual fund issues, rate changes, FD maturity, missed savings target and portfolio imbalance. The menu is organised into Trading, My Portfolio, Wealth and Market & Updates.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
