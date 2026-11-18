/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.22.1";
export const RELEASED = "2026-11-18";
export const NOTES = [
  "Never silently out of date: if this device is missing the last trading day, the market badge at the top says so in orange with the date it has; tap it to fetch the latest prices at once.",
  "Daily data always arrives: every device now fills in any missed trading days from a small file (about 150 KB) within seconds of opening, even on a slow connection while the full daily file is still downloading.",
  "Screens update by themselves: when new prices arrive, or when you come back to the app, the page you are on refreshes without you moving to another page.",
  "Mac version catches up at once: it takes the latest published prices from the cloud within a second of starting, and refreshes prices, history and indices right away instead of waiting.",
  "Downloads that stall (for example when the phone app goes to the background) now continue from where they stopped.",
  "Calendar: 30 Kartik (16 Nov) was a public holiday after Chhath, so there was no trading that day.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
