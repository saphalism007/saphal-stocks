/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.0";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Smooth drawing: lines now follow your finger or mouse exactly while you stretch them (a steady 60 frames a second), instead of jumping from candle to candle. The magnet only grabs an open, high, low or close when you are right next to it. Moving a whole drawing slides it smoothly.",
  "Drawing tool menus: tap any tool icon on the left to open its full menu, like other charting sites. 48 tools in 7 groups, with keyboard shortcuts shown.",
  "18 new drawing tools: Flat top/bottom, Disjoint channel, Schiff and Modified Schiff pitchforks, Fib channel, Fib time zones, Fib speed fan, Gann fan, Gann box, XABCD and ABCD patterns (with leg ratios), Head and shoulders (with neckline), Triangle pattern, Elliott impulse (12345) and correction (ABC) waves, Circle, Curve, Price label and Flag.",
  "More reliable updates: GitHub was skipping its own 15-minute market updates. While your Mac is on, it now asks GitHub for an update at 10:35 (news and prices before the open), every 15 minutes from 11:00 to 15:15, and at 15:50 (full daily update). The Mac app itself also fetches news before the open.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
