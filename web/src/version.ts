/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.15.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Tax updated to the Finance Act 2083 (FY 2083/84, from IRD's official handbook): capital gains tax on listed shares is now 10% (held ≤ 365 days) and 7.5% (longer), up from 7.5% / 5%. Sales before 17 July 2026 keep the old rates. All profit, holdings and signal figures now use the new rates.",
  "Money Calculators page: income tax 2083/84 (new single table: 1% to Rs. 10 lakh, then 10/20/27/29%; SSF, CIT/EPF, insurance, children's school fees, women's rebate), share sale tax & fees, dividend/interest/property tax, step-up SIP, lump sum vs monthly, goal saving, retirement fund, real return, CAGR, average price, bonus/right price, debenture yield, rent vs buy, loan affordability and gold buying cost. Sliders and instant results.",
  "Which is best?: compare savings, FD, T-bills, mutual funds/NEPSE, gold and silver for your amount and years — after tax, after inflation, with each one's worst historical fall.",
  "Wealth roadmap (My Growth): the 10 steps from budgeting to investing, ticked off automatically from your own data, with a button for each next step.",
  "More ways to grow money: rental income, commercial farming & livestock, freelancing/online work for foreign clients, and government savings & foreign employment bonds, with official links.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
