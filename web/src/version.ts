/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.17.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Invest or Trade? (new page): the fundamentally strongest stocks to invest in and the technically strongest to trade, ranked 0–100 with the reasons, plus stocks strong on both and the top picks in every sector. Each opens its ⚡ buy/sell signal.",
  "Purchase Planner (new page): give every planned purchase its own pot (e.g. TV + PS5 Pro worth Rs. 3 lakh): the monthly amount to set aside, where to keep it, progress against the plan, a budget check, deposits and withdrawals, and a 'ready to buy' checklist. Templates for Dashain & Tihar, school fees, insurance, gadgets, bikes, travel, weddings and vehicle costs.",
  "Buy on EMI or save first? See the real extra cost of an EMI and how soon you could pay cash by saving the same amount.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
