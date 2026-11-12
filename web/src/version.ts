/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.2";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Zoom stays exactly where you point: the candle under your mouse or trackpad pointer stays under it while you zoom in or out, even when you scroll quickly.",
  "iPhone and iPad: moving a drawing with your finger no longer stops after a few pixels (the browser was taking the touch over for scrolling). Drawing, moving and stretching lines now follow your finger smoothly on Mac, iPhone and iPad.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
