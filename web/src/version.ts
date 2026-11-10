/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.18.1";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Clearer investment-channel links: every button now says what it does ('Register a business', 'Tax on rent (IRD)', 'Apply in MeroShare', 'Check IPO result', 'Today's official gold rates'…) instead of a bare web address, with the most useful in-app tool first (e.g. Rent vs buy calculator, Every fund + apply links). 'Your own business' now links to the Office of the Company Registrar.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
