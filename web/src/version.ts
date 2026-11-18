/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.23.0";
export const RELEASED = "2026-11-18";
export const NOTES = [
  "Live prices during market hours on every device: a small relay on Cloudflare reads ShareSansar's live-trading page about once a minute and every device (iPhone, iPad, Mac) shows those prices, about 1 to 2 minutes behind the market. No Mac needs to be running.",
  "Live index values too: NEPSE and all 16 sub-indices update through the session.",
  "Fixed: during the day the app used a page that only changes after the close, so 'live' prices were really the previous day's. It now uses the live-trading page. The official closing prices still replace the live ones each evening.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
