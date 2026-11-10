/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.17.1";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Cleaner screens: every info box now has a ✕ to minimise it to a small 'Note' pill (tap to bring it back; remembered on this device). Page descriptions show two lines on phones — tap to read more. AI answers no longer repeat the 'AI narrative is off' line, and the suggested questions wrap neatly.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
