/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.30.0";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Portfolio command centre for each portfolio: what you would receive if you sold everything today, the money at risk if every stop is hit, the extra if first sell zones are reached, portfolio strength, what to do now, dates coming up, smart money on your stocks, concentration risks, the economy for your sectors, and research ideas that add a new sector.",
  "Plans follow each portfolio's strategy, changeable from the command centre: long-term, dividend, value and growth portfolios use long-term stops (weekly close below the 200-day average); swing trading portfolios use the daily signal.",
  "Every holding now shows its weight in the portfolio, smart money (phase, big brokers buying or selling, manipulation risk), holding strength, what you receive today, at the stop and at the first sell zone after charges and tax, the odds from here, dated guidance (book closure with your dividend and bonus shares, the long-term tax date, review dates), and the full research in one tap.",
  "The 52-week high now counts as a sell zone when no resistance is measured above.",
  "Trading Opportunities shows how every listed company was judged today (buy, close to a buy, hold, no setup, downtrend, illiquid, sell, too new), and the stocks closest to a buy with exactly what is still missing.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
