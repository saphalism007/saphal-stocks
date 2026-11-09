/**
 * The app's version and what changed in it, shown in the sidebar and on Settings → About.
 * Every release gets a new number: scripts/bump.mjs raises it when publishing (npm run deploy)
 * unless it was already changed by hand. The build publishes it as version.json, which the
 * app reads to know whether it is the latest. The code is the first 6 characters of the
 * release's git commit, the same code the deploy script prints.
 */
export const VERSION = "0.11.0";
export const RELEASED = "2026-11-09";
export const NOTES = [
  "Chart Terminal rebuilt: candles, hollow, Heikin Ashi, bars, line, step, area and baseline charts; daily, weekly and monthly candles; date ranges and a custom range; 1, 2 or 4 charts at once; full screen and chart pictures.",
  "64 indicators with a searchable library: moving averages, VWAP, Ichimoku, Supertrend, SAR, ADX, RSI, MACD, Stochastic, CCI, MFI, OBV, CMF and more, on the price or in their own panels, with your own settings, colours and saved templates.",
  "30 drawing tools in a left toolbar: trendlines, rays, channels, pitchfork, Fibonacci, shapes, brush, text, price/date ranges and long/short positions. Drag to draw, move, edit, lock, undo, with magnet snapping; saved per stock.",
  "AI Analyst beside every chart: a clear verdict (Strong buy to Strong sell, or Wait), entry, best buying zone, breakout entry, stop-loss and three targets, with the evidence in numbers; support, resistance and supply/demand zones drawn on the chart; strategies from very short-term to long-term; separate short, medium and long-term suitability.",
  "Ask AI about the chart (works without a key; uses Claude with your key), a trade planner that saves and tracks plans or paper-trades them, and a scanner for buy setups, breakouts, momentum, oversold/overbought, reversals and volume spikes.",
  "Company pages: Quarterly Reports, Annual & Audit Reports, Notices & Announcements, News and Downloads, linking to the company's official website pages and PDFs. Quarterly, annual and audited documents are never mixed up, and the newest files are checked to open.",
  "Compare financial reports: put quarterly reports of the company or its peers side by side (revenue, profit, EPS, reserves, liabilities, deposits, NPL and more).",
];

declare const __BUILD__: string;
/** The git commit this copy was built from ("dev" when running locally). */
export const BUILD: string = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
export const codeOf = (build: string) => (build && build !== "dev" ? build.slice(0, 6).toUpperCase() : "DEV");
export const CODE = codeOf(BUILD);
