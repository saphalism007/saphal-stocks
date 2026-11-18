/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.24.0";
export const RELEASED = "2026-11-18";
export const NOTES = [
  "Portfolio: type the first letter of a symbol and every listed NEPSE company starting with it appears, with its name, sector and live price. Picking one fills in today's price.",
  "Accurate bills: each purchase and sale now shows broker commission (with its slab rate), SEBON fee 0.015% and the Rs. 25 CDSC DP charge, which also applies to purchases. Totals, cost per share, your new WACC and the break-even price are shown before you save.",
  "Capital gains tax updated: 5% (held 365 days or less) and 3.75% (held longer) for individuals from 22 September 2026, per the Nepal Gazette. Each sale uses the rate in force on its date (10% / 7.5% from 17 July to 21 September 2026, 7.5% / 5% before).",
  "Selling shows your gain against WACC, the holding period, the tax, and your net profit after tax, and warns when a holding is close to becoming long term.",
  "New on Portfolio: today's gain from live prices, a Today column, an allocation chart, easy holding cards on the phone, and full charges and totals for every transaction.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
