/**
 * The app's version and what changed in it, shown in the sidebar and on Settings > About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.27.1";
export const RELEASED = "2026-11-22";
export const NOTES = [
  "Split Expenses: download or send the settlement sheet as PDF, image (best for WhatsApp and Viber), Excel (three sheets, opens in Excel and Numbers), CSV or text. Tap a format, then Send or save to open the share sheet (WhatsApp, Viber, Messages, Mail, AirDrop, Save to Files); on a Mac it can also save to Downloads. Names in Nepali script come out correctly.",
  "New: Split Expenses (menu, under Money Calculators). Make a group, add the people, then add each bill: who paid (one or several people), and who it is for (everyone or only some), split equally, by shares or by exact amounts. It shows each person's share and balance, and the fewest payments to settle up, exact to the paisa. Share the result to any chat in one tap.",
  "Your groups are saved with your personal data, so they come along with backups and device sync.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
