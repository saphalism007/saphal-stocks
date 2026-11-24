/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.32.0";
export const RELEASED = "2026-11-24";
export const NOTES = [
  "Plan history on every holding: the plan that was recommended (date, source, buy range, stop, targets), what it meant at your purchase price (inside or outside the range, risk to the stop, reward to target 1), the plan you follow now, and today's fresh chart reading, side by side, with a plain explanation of anything that changed and why.",
  "Holdings now follow the recommendation they were bought on by default: its stop holds and can only be raised to lock in profit, never lowered, and its targets stay. 1-2 week buys get a sell-by date in trading days. Switch any holding to the portfolio's strategy (for example long-term stops) with one tap, and back.",
  "Adding a purchase shows the app's plan for that stock at that moment (trade signal, 1-2 week list, research verdict) and saves it with the purchase, so it can always be compared later. It syncs to all your devices.",
  "Every day's buy recommendations are now logged with their levels in the cloud, so older purchases are matched to what was recommended at the time.",
  "Fixed: a holding bought on a trade signal in a long-term portfolio silently switched to a much wider long-term stop. It now keeps the original stop unless you choose otherwise.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
