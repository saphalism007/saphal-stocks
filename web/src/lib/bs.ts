// Nepali (Bikram Sambat) dates from the open-source nepali-date-converter calendar table (MIT; BS 2000–2090,
// about 1943–2034 AD). Verified against 1 Baisakh 2081/2082/2083 and 1 Shrawan 2083 = 17 July 2026.
// Dates outside that range return null, and screens fall back to AD dates for them.
import NepaliDate from "nepali-date-converter";

export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
export interface BSDate { y: number; m: number; d: number } // m: 1 = Baisakh … 12 = Chaitra
export const bsAvailable = true;
const cache = new Map<string, BSDate | null>();
export function toBS(iso: string): BSDate | null {
  const hit = cache.get(iso); if (hit !== undefined) return hit;
  let out: BSDate | null = null;
  try { const [y, m, d] = iso.split("-").map(Number); const n = new NepaliDate(new Date(y, m - 1, d)); out = { y: n.getYear(), m: n.getMonth() + 1, d: n.getDate() }; } catch { out = null; }
  if (cache.size > 100_000) cache.clear();
  cache.set(iso, out);
  return out;
}
/** AD date (YYYY-MM-DD) of a BS date, or null outside the supported range. */
export function fromBS(b: BSDate): string | null {
  try { const j = new NepaliDate(b.y, b.m - 1, b.d).toJsDate(); return `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, "0")}-${String(j.getDate()).padStart(2, "0")}`; } catch { return null; }
}
/** Nepali fiscal year (1 Shrawan to end of Ashadh), e.g. "2083/84". */
export const fiscalYearOf = (b: BSDate) => (b.m >= 4 ? `${b.y}/${String((b.y + 1) % 100).padStart(2, "0")}` : `${b.y - 1}/${String(b.y % 100).padStart(2, "0")}`);
export const bsLabel = (b: BSDate) => `${b.d} ${BS_MONTHS[b.m - 1]} ${b.y}`;
export const bsOf = (iso: string | null | undefined) => { if (!iso) return ""; const b = toBS(iso.slice(0, 10)); return b ? bsLabel(b) : ""; };
