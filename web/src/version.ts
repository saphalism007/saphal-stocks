/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.13.1";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "⚡ Buy/Sell signal button on every chart: one tap shows the verdict, buy zone, breakout buy, stop-loss, three targets, risk:reward, exact orders with dates, support and resistance, technical readings (trend, RSI, MACD, ADX, moving averages, volume), fundamentals (EPS, P/E vs sector, P/B, ROE, debt, Graham value, growth, dividends), the reasons, the risks and how past signals did — and draws the levels and B/S arrows on the chart.",
  "On phones the price scale stays automatic, so a stray swipe on the price axis can no longer squash the candles.",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
