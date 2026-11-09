/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.8.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Income & expense tracker (My Money → Daily tracker): add entries in seconds, see them by date and category, monthly totals, a 6-month trend and CSV export; turn your averages into your budget.",
  "Back up to iCloud Drive or Google Drive in one tap (share sheet → Save to Files), restore on any device, with a weekly reminder.",
  "Number boxes fixed everywhere: they clear properly, typing replaces the old value, and amounts show as 60,00,000.",
  "Reports & audit: every stock has a tab with audited results, annual-report filings, auditor and AGM notices and the company website; Reports lists the latest audited filings across NEPSE.",
  "Cleaner iPhone layout: short greeting with your name, compact header, tidy cards and forms, and the tab bar now reaches the bottom edge.",
  "Faster start: market-wide analysis is precomputed, so the home screen opens in a few seconds. AI setup explained step by step (Settings → AI).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
