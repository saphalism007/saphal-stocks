/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.3";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "Zoom from exactly where you point, anywhere: on old prices, on today's candle, or in the empty space to the right for future projections. The spot under your pointer now stays there (within a pixel) however fast you scroll or pinch, and zooming near today no longer slides back in time.",
  "Room for the future: you can zoom and scroll past today into the future area to draw projections; the latest candle always stays on screen.",
  "Trackpad: a zoom swipe no longer turns into scrolling back in time when your fingers drift sideways; a clearly sideways swipe still scrolls.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
