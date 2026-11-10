/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.19.1";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Nepali calendar added (verified against Nepali New Year 2081–2083 and 1 Shrawan 2083 = 17 July 2026). The Loan & EMI Planner now shows every instalment's Nepali date, groups the schedule and yearly summary by Nepali fiscal year (Shrawan–Ashadh), lets you enter the start date in BS, and — bank style — can put instalments on the same Nepali date each month. The CSV includes Nepali dates and fiscal years.",
  "Book closures in My Growth → Dividends & events now show the Nepali date too.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
