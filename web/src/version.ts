/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.6";
export const RELEASED = "2026-11-16";
export const NOTES = [
  "Opens instantly: the app no longer waits for GitHub each time you open it; it starts from the copy saved on your device (about 0.07 seconds instead of 2 or more on a slow connection). Updates still arrive in the background, and Update now installs them.",
  "Shows your last data at once: the Dashboard and other pages appear immediately with what you saw last time, then refresh with the latest data a moment later.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
