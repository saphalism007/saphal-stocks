/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.5";
export const RELEASED = "2026-11-15";
export const NOTES = [
  "Opens instantly again: the app used to wait for the whole new market file (about 15 MB) before opening whenever a daily update existed, which took minutes on a slow connection. It now opens at once from the data saved on your device, applies the latest prices from a small file, and fetches the full new file quietly in the background.",
  "Shares its web address politely: the app no longer removes the offline files of your other apps at the same address (for example Saphal Manifest).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
