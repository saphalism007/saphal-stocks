/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.18.0";
export const RELEASED = "2026-11-10";
export const NOTES = [
  "Brokers & Mutual Funds (new page): every open-ended and close-ended mutual fund with its NAV, price vs NAV, fund manager, the manager's verified official website and — where the manager's own site links one — the direct online SIP/apply page. Close-ended funds link to buying through your broker.",
  "All 90 SEBON-licensed stockbrokers with address, phone, email and contact person (searchable by name or city), plus broker activity by number: who bought and sold most, which stocks they're accumulating, and their TMS address.",
  "Open-ended mutual funds (with daily NAV) are now collected every day.",
  "Smarter AI Analyst: ask about mutual funds and SIPs, brokers (e.g. 'brokers in Pokhara'), market mood, or the best stocks to invest in or trade — it answers from the app's data even without an AI key, and with your Claude key it can look all of this up itself.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
