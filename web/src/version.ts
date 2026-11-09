/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.7.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Home now has two pillars, NEPSE Intelligence and My Financial Life, plus an 'Ask AI' button on every page.",
  "My Money: income, spending by category, savings, FDs, investments and loans, with net worth, cash flow, savings rate, emergency fund cover and specific suggestions worth rupees.",
  "Where to Invest: 'I have Rs. X' allocation advisor, fixed-deposit comparison after tax and inflation, official bank rate notices (read with AI), NRB rates and inflation, mutual funds, debentures, T-bills, and prepay-or-invest.",
  "Market Monitor: NRB rate changes, the latest NRB macro report, IPO/FPO and fund issues, reports, dividends and regulatory notices, each with what it could mean for you.",
  "Charts: daily, weekly and monthly candles, automatic trendlines with breakout and volume confirmation, and demand/supply zones drawn on the chart.",
  "Daily briefing adds interest-rate changes, attractive opportunities, your money and the smartest action to consider today; goal scenarios now use real FD and NEPSE returns.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
