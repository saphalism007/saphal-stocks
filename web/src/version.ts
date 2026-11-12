/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.20.3";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Indicator list on the chart is organised: tapping an indicator no longer adds it again and again. Tap its name to open the full guide (what it shows, how to read it, buy and sell signals, best use, trap, tip, settings, origin). Use Add to put it on the chart and Remove to take it off; + Another adds a second copy only when you want one.",
  "Sorting: sort indicators by recommended order, name A to Z, name Z to A, or by type, both in the chart's indicator list and on the Indicator Guide page. Your choice is remembered.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
