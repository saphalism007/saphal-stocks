/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.12.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Gold & silver: official FENEGOSIDA daily rates since 2013 with a price chart, 1-year and 10-year returns and the worst falls. Gold (and a little silver for high risk) is now part of your diversified plan.",
  "More ways to grow money in Nepal: land and property, specialised investment funds, your own business, skills; cooperatives listed with clear warnings, and what to avoid (crypto, unapproved foreign investing, MLM schemes).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
