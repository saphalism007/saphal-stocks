/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.19.3";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Loan schedule shown in the app in the view you choose: each instalment, or totals by Nepali month, quarter (Q1 Shrawan–Ashwin…), half-year or fiscal year — paged (25 to 500 rows), with a totals row, jump to any instalment, and a CSV of that view. All amounts in Nepali format (10,00,000.00), including the CSV.",
  "Bank-accurate rounding: interest is rounded to the paisa each instalment and principal = instalment − interest, so every row and the totals add up exactly.",
  "Years, days and instalment numbers no longer show commas (2083, not 2,083); the start-date box fits on phones.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
