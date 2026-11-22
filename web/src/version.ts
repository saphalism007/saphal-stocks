/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.31.0";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Trading Opportunities: new Buy and hold 1-2 weeks list. Every liquid stock is scored for a short move (trend, momentum, volume, money flow, breakout or pullback, strong close; pumps and illiquid stocks are excluded), then checked against the full research: business, reports, news, smart money and manipulation, market and economy. Stocks the research is against are listed separately with the reason.",
  "Each pick shows the buy range, stop, two targets (sell half at the first), a 10-session time stop, position size for 1% risk, whether today's price is still in the buy range, and the research and smart money read. Tap for the company page and trade plan.",
  "The same rules are replayed over the past year exactly as you would trade them, after all charges and tax, for the whole year, the last 60 sessions and each setup type. The list calls itself a Buy list only when that record is positive; until then it is labelled Candidates only, with a clear warning.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
