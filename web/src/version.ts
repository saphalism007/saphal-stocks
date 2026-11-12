/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.20.0";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Indicator Guide: all 100 chart indicators, from the USA, Japan, Australia, France and more, each explained to the point: what it shows, how to read it, the buy signal, the sell signal, when it works best, the common trap and a tip. Every card shows a live reading and a mini chart on a real stock, plus a consensus of all 100 for that stock. One tap adds any indicator to your chart. Start with the 10 essentials in order.",
  "34 new indicators on the chart (100 in total), including Zero-lag EMA, T3, McGinley Dynamic, VIDYA, Alligator, Fractals, Schaff Trend Cycle, Connors RSI, Laguerre RSI, KST, Klinger, Psychological Line and Disparity Index.",
  "On the chart, tap ? next to any indicator to see what it says right now in plain words, with its buy and sell rules and a link to the full guide.",
  "Before the bell: the Dashboard now opens with every announcement and news item since the last close, your own stocks first, and a countdown to 11:00. News is now also fetched before the open (about 10:45), around 13:00 and after the close.",
  "Market moments: a short notice at pre-open, at the 11:00 open and at the 15:00 close with the day's summary (NEPSE, breadth and your portfolio). You can also allow device notifications, or turn the notices off.",
  "Smoother everywhere: pages load quietly in the background so taps open instantly, pages you revisit show at once and refresh behind the scenes, and buttons respond to every tap.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
