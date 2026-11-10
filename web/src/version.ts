/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.19.0";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Loan & EMI Planner (new page): bank-style amortisation with daily, weekly, fortnightly, monthly, quarterly, half-yearly or yearly payments; EMI, equal principal, interest-only or balloon; interest per instalment or daily on actual days (365); grace period; extra and lump-sum prepayments (finish sooner or lower the EMI); floating rate changes; processing fees and the true cost with fees. Leave one of amount, rate, tenure or instalment empty and it is calculated.",
  "Schedules of any length (a daily loan over 100 years has 36,500+ rows) are grouped by year, open one year at a time, jump to any instalment number, and download as CSV. A yearly summary shows interest and principal paid each year.",
  "Pay cash or take the loan and invest the rest? Compares your money at the end both ways, checks the EMI against your income, and explains when borrowing to invest makes sense.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
