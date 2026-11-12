/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.21.4";
export const RELEASED = "2026-11-12";
export const NOTES = [
  "iPad (finger and Apple Pencil): drag the price column on the right up or down to squeeze or stretch prices, and drag the chart up and down as well as sideways, just like a Mac trackpad. Double-tap the price column (or tap auto) to reset. iPhone keeps its simpler touch behaviour.",
  "Apple Pencil drawing: lines follow the Pencil tip exactly and keep following it even if it moves past the chart's edge.",
  "On screens narrower than 1200 pixels (an iPad held upright, for example) the chart opens without the AI panel so it gets the full width; tap Show panel at the top right to bring it back.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
