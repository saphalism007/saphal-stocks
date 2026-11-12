/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.20.1";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Accurate market status: the app now knows NEPSE holidays. It shows Closed today with the reason (for example the Tihar holiday, 8 to 12 November) and when the next session opens. Holidays not yet in the calendar are caught from the official closure notice in the news, or when no trades are reported by 11:20.",
  "Buy and sell instructions now name the real next trading session, skipping holidays.",
  "The Mac version (Start Saphal Stocks) opens correctly again after an update.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
