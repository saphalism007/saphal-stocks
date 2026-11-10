/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.19.2";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Nepali dates now continue forever: after BS 2090 (where the official published calendar ends) dates and fiscal years are projected from the sun's yearly cycle, fitted to the real calendar. Tested against known years: 94% of month starts exact, the rest within one day. Projected dates are marked with *. Long loans stay on the same Nepali date every month to the end.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
