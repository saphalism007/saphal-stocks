/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.11.1";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Phone layout fixed: no more text running off the screen on iPhone; long labels wrap neatly and wide tables scroll inside their card.",
  "New investment plan builder: start with Rs. 0 today and invest monthly, set different amounts for each month (any month can be 0), and raise them each year. The plan covers costly debt and the emergency fund first, then spreads money across deposits, debentures and bonds, CIT, mutual fund SIPs, close-ended funds, stocks and IPOs, with a year-by-year outlook.",
  "Links to every investment channel in Nepal (NEPSE, MeroShare, SEBON, NRB, PDMO, CIT, EPF, SSF, insurance), each checked daily.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
