/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.13.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Clean charts: the chart opens with just candles and volume; indicators, AI levels and markers appear only when you turn them on. One-tap ✧ Clean hides everything (nothing is deleted).",
  "Full screen on iPhone, iPad and Mac: tap ⛶ on the chart. Works in portrait and landscape; the browser's own full screen is used where allowed.",
  "Smoother drawing: trendlines follow your finger or mouse frame by frame, are easier to grab on touch screens, and no longer make the page scroll while you drag.",
  "Charts refresh themselves when new prices arrive (checked every minute in market hours), keeping your zoom and drawings.",
  "Smarter search: stocks by symbol, any word of the name, initials or a typo, with today's price; sectors; every tool and page (gold, SIP, FD rates, IPO…); news; 'nabil chart' or 'nica dividend' go straight there; and Ask AI for anything else. The update banner no longer covers the results.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
