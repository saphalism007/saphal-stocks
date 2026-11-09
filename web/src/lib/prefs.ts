// Appearance and behaviour preferences. Saved with your personal data (so they sync between
// devices when sync is on) and cached locally so the app opens without a flash of defaults.
import { setNumberStyle } from "./format.ts";

export type ThemePref = "auto" | "light" | "dark";
export interface Prefs {
  theme: ThemePref;
  accent: "emerald" | "blue" | "violet" | "amber" | "rose";
  scale: number; // interface size: 0.9 - 1.25
  density: "comfortable" | "compact";
  numbers: "nepali" | "international";
  landing: string; // start page path
  hiddenNav: string[]; // paths hidden from the menu
  bottomBar: string[]; // up to 4 paths shown in the phone tab bar
  sidebar: "full" | "rail";
  chartOverlays: string[];
  chartLower: string;
  chartKind: "candles" | "line";
  reduceMotion: boolean;
  name: string; // how the home screen greets you
}

export const DEFAULT_PREFS: Prefs = {
  theme: "auto", accent: "emerald", scale: 1, density: "comfortable", numbers: "nepali", landing: "/",
  hiddenNav: [], bottomBar: ["/", "/trading", "/money", "/analyst"], sidebar: "full",
  chartOverlays: ["sma50", "sma200"], chartLower: "rsi", chartKind: "candles", reduceMotion: false, name: "Saphal",
};

const KEY = "ss-prefs";
export function cachedPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Prefs>) }; } catch { return DEFAULT_PREFS; }
}
export function cachePrefs(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: light)") : null;
export const resolveTheme = (t: ThemePref) => (t === "auto" ? (mq?.matches ? "light" : "dark") : t);

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const theme = resolveTheme(p.theme);
  root.dataset.theme = theme;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  root.dataset.sidebar = p.sidebar;
  root.dataset.motion = p.reduceMotion ? "reduce" : "full";
  root.style.setProperty("--ui-scale", String(p.scale));
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", theme === "dark" ? "#070b14" : "#f4f6fb"));
  setNumberStyle(p.numbers);
  return theme;
}

export function onSystemThemeChange(fn: () => void) { mq?.addEventListener("change", fn); return () => mq?.removeEventListener("change", fn); }
