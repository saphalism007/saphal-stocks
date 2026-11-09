// Nepali number formatting: lakh/crore grouping (en-IN), Rs. prefix, Asia/Kathmandu dates.

export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// "nepali" = lakh/crore grouping (12,50,000 · 1.25 Cr); "international" = millions/billions (1,250,000 · 1.25 M).
let style: "nepali" | "international" = "nepali";
export function setNumberStyle(s: "nepali" | "international") { style = s; }
const LOCALE = () => (style === "nepali" ? "en-IN" : "en-US");
export const numberLocale = () => LOCALE();

export function num(x: unknown, digits = 2): string {
  if (!isNum(x)) return "—";
  return x.toLocaleString(LOCALE(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function int(x: unknown): string {
  if (!isNum(x)) return "—";
  return Math.round(x).toLocaleString(LOCALE());
}

export function rs(x: unknown, digits = 2): string {
  if (!isNum(x)) return "—";
  return `Rs. ${num(x, digits)}`;
}

/** Compact NPR: 1.25 Cr, 45.2 L, 12.5 K. */
export function compact(x: unknown, prefix = "Rs. "): string {
  if (!isNum(x)) return "—";
  const a = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (style === "international") {
    const f = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (a >= 1e12) return `${sign}${prefix}${f(a / 1e12)} T`;
    if (a >= 1e9) return `${sign}${prefix}${f(a / 1e9)} B`;
    if (a >= 1e6) return `${sign}${prefix}${f(a / 1e6)} M`;
    if (a >= 1e3) return `${sign}${prefix}${f(a / 1e3)} K`;
    return `${sign}${prefix}${f(a)}`;
  }
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Arba`;
  if (a >= 1e7) return `${sign}${prefix}${(a / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  if (a >= 1e5) return `${sign}${prefix}${(a / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toLocaleString("en-IN", { maximumFractionDigits: 1 })} K`;
  return `${sign}${prefix}${a.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function pct(x: unknown, digits = 2, sign = true): string {
  if (!isNum(x)) return "—";
  return `${sign && x > 0 ? "+" : ""}${x.toFixed(digits)}%`;
}

export const tone = (x: unknown) => (!isNum(x) || x === 0 ? "" : x > 0 ? "up" : "down");

export function nptDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Asia/Kathmandu" });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function scoreColor(s: number | null | undefined) {
  if (!isNum(s)) return { background: "var(--panel-3)", color: "var(--text-3)" };
  if (s >= 70) return { background: "var(--up-soft)", color: "var(--up)" };
  if (s >= 50) return { background: "var(--blue-soft)", color: "var(--blue)" };
  if (s >= 35) return { background: "var(--warn-soft)", color: "var(--warn)" };
  return { background: "var(--down-soft)", color: "var(--down)" };
}

export const todayNpt = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
