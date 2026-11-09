/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.8.1";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Audit reports: tap any company under Audit Reports (or the Audit report button on a stock page) to see its audited financial statements as published, full screen, with earlier years one tap away.",
  "166 companies covered so far (FY 2082/83 statements are added as companies publish them before their AGMs); the list updates daily.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
