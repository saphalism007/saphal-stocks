/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.14.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "New page: My Growth. Today: a to-do list of what needs you (stops hit, targets reached, watchlist stocks in their buy zone, book closures, IPOs closing, thesis reviews, journal trades).",
  "Holdings plan: every share you own with the chart verdict, stop-loss, target, support/resistance, weight, what to do (sell, trim, take profit, hold, add, diversify), the fees and capital gains tax if sold today, and expected dividend income.",
  "Discipline coach: a pre-buy checklist that works out how many shares to buy from the risk you accept and checks 9 rules (GO / CAREFUL / DON'T BUY), plus the habits in your own trades (wins vs losses, holding losers too long, ignoring stops, selling winners early, revenge trades, emotions).",
  "Dividends & events calendar: upcoming book closures, open and upcoming IPOs and right shares, and AGM/dividend notices for your holdings and watchlist (or the whole market).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
