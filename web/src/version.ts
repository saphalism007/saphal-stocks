/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.30.1";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Fixed: on iPhone, tapping a stock in Trading Opportunities only dimmed the screen because the window opened off screen. All pop-up windows now open on top of the page on every device, and close with Escape.",
  "Tapping any stock in Trading Opportunities (research picks, closest to a buy, brokers' favourites, the signal tables) now opens its full company page with the research expanded.",
  "Every company page has a new Trade plan tab: buy range, stop, targets, position size, alerts and paper trading.",
  "Any stock symbol anywhere in the app opens that company's page.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
