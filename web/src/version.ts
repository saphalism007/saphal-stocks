/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.12.1";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Chart cleaned up: only the levels that matter (Buy zone, Stop, targets, Breakout, nearest Support/Resistance), with close levels merged; indicators no longer squash the price; no overlapping text; indicator labels fold away on phones.",
  "Exact orders in 'What to do': buy between Rs. X and Y on the next session (date and 11 AM–3 PM), sell half at T1, the rest at T2, stop-loss on a close below Rs. Z, and a separate plan if you already own the stock.",
  "Buy/sell arrows on the chart: past buy signals (B) and where they sold (S, with the result), plus today's action on the last candle. Trading days follow NEPSE's current week (Monday to Friday).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
