/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.29.0";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Smart money and manipulation check in every recommendation: the Wyckoff phase (accumulation, markup, distribution, markdown) from price, volume and money flow, plus the broker-by-broker floorsheet (whether a few brokers are collecting shares while many sell, or the reverse), crossing and circular trading, and operator footprints such as sharp run-ups on unusual volume, repeated limit-up days, dumps after spikes and small, thinly traded companies.",
  "A buy is held back when there are signs of operator activity, distribution or big brokers selling; Accumulate is never given while big brokers distribute. Your portfolio plans warn you when a holding shows these signs.",
  "Economy, policy and politics in every recommendation: NRB's latest figures (lending and interbank rates, deposits vs loans, remittances, reserves, inflation, policy rate), headlines on politics, policy, the economy, India and the world, sector-specific news, and the budget and monetary policy calendar.",
  "Trading Opportunities: a new Smart money and economy card with the economic backdrop, the stocks the biggest brokers net bought and sold, and stocks showing accumulation, distribution or possible operator activity. Each research card shows the phase, broker flow, manipulation risk and economy at a glance.",
  "The floorsheet now records crossed trades (same broker on both sides) and keeps 30 sessions in the cloud.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
