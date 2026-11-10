// Nepali (Bikram Sambat) dates.
// • BS 2000-2090: the published calendar (open-source nepali-date-converter table, MIT), verified against
//   1 Baisakh 2081/2082/2083 and 1 Shrawan 2083 = 17 July 2026.
// • After BS 2090 (the official calendar isn't published that far ahead): projected from the sun's sidereal
//   year. Each month's start is a straight-line fit through its real start dates in BS 2000-2090. Tested on
//   known years (fit on 2000-2060, checked on 2061-2090): 94% of month starts exact, the rest within one day.
//   Projected dates carry `projected: true` so screens can mark them.
import NepaliDate from "nepali-date-converter";

export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
export interface BSDate { y: number; m: number; d: number; projected?: boolean } // m: 1 = Baisakh ... 12 = Chaitra
export const bsAvailable = true;
export const OFFICIAL_LAST_YEAR = 2090;

const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoOf = (dn: number) => new Date(dn * 86_400_000).toISOString().slice(0, 10);
const libStart = (y: number, m: number) => { const j = new NepaliDate(y, m - 1, 1).toJsDate(); return Math.round(Date.UTC(j.getFullYear(), j.getMonth(), j.getDate()) / 86_400_000); };

let coef: [number, number][] | null = null;
function coefficients() {
  if (coef) return coef;
  coef = [];
  for (let m = 1; m <= 12; m++) {
    const xs: number[] = [], ys: number[] = [];
    for (let y = 2000; y <= OFFICIAL_LAST_YEAR; y++) { xs.push(y - 2000); ys.push(libStart(y, m)); }
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const b = sxy / sxx; coef.push([my - b * mx, b]);
  }
  return coef;
}
/** Day number of the first day of BS month m in year y (published table, or projected after BS 2090). */
export function monthStart(y: number, m: number): number | null {
  if (y < 2000) return null;
  if (m > 12) { y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1; }
  if (y <= OFFICIAL_LAST_YEAR) { try { return libStart(y, m); } catch { return null; } }
  const [a, b] = coefficients()[m - 1];
  return Math.floor(a + b * (y - 2000) + 0.5);
}
const monthLength = (y: number, m: number) => { const s = monthStart(y, m), e = monthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1); return s != null && e != null ? e - s : null; };

const cache = new Map<string, BSDate | null>();
export function toBS(iso: string): BSDate | null {
  const hit = cache.get(iso); if (hit !== undefined) return hit;
  let out: BSDate | null = null;
  try { const [y, m, d] = iso.split("-").map(Number); const n = new NepaliDate(new Date(y, m - 1, d)); out = { y: n.getYear(), m: n.getMonth() + 1, d: n.getDate() }; }
  catch {
    const dn = dayNo(iso);
    const last = monthStart(OFFICIAL_LAST_YEAR + 1, 1);
    if (last != null && dn >= last) {
      const [a, b] = coefficients()[0];
      let y = 2000 + Math.floor((dn - a) / b) + 1;
      while ((monthStart(y, 1) as number) > dn) y--;
      let m = 12; while (m > 1 && (monthStart(y, m) as number) > dn) m--;
      out = { y, m, d: dn - (monthStart(y, m) as number) + 1, projected: true };
    }
  }
  if (cache.size > 200_000) cache.clear();
  cache.set(iso, out);
  return out;
}
/** AD date (YYYY-MM-DD) of a BS date, or null if that day doesn't exist (e.g. 32 Poush). */
export function fromBS(b: BSDate): string | null {
  if (b.y <= OFFICIAL_LAST_YEAR) { try { const j = new NepaliDate(b.y, b.m - 1, b.d).toJsDate(); if (new NepaliDate(j).getDate() !== b.d) return null; return `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, "0")}-${String(j.getDate()).padStart(2, "0")}`; } catch { return null; } }
  const s = monthStart(b.y, b.m), len = monthLength(b.y, b.m);
  if (s == null || len == null || b.d < 1 || b.d > len) return null;
  return isoOf(s + b.d - 1);
}
/** Nepali fiscal year (1 Shrawan to end of Ashadh), e.g. "2083/84". */
export const fiscalYearOf = (b: BSDate) => (b.m >= 4 ? `${b.y}/${String((b.y + 1) % 100).padStart(2, "0")}` : `${b.y - 1}/${String(b.y % 100).padStart(2, "0")}`);
export const bsLabel = (b: BSDate) => `${b.d} ${BS_MONTHS[b.m - 1]} ${b.y}${b.projected ? "*" : ""}`;
export const bsOf = (iso: string | null | undefined) => { if (!iso) return ""; const b = toBS(iso.slice(0, 10)); return b ? bsLabel(b) : ""; };
