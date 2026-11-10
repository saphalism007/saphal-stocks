// Nepali (Bikram Sambat) dates. The conversion needs a verified BS calendar table; until one is added,
// `toBS` returns null and screens show AD dates with calendar-year grouping instead of Nepali fiscal years.
export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
export interface BSDate { y: number; m: number; d: number } // m: 1 = Baisakh … 12 = Chaitra
export const bsAvailable = false;
export function toBS(_iso: string): BSDate | null { return null; }
/** Nepali fiscal year (1 Shrawan to end of Ashadh), e.g. "2083/84". */
export const fiscalYearOf = (b: BSDate) => (b.m >= 4 ? `${b.y}/${String((b.y + 1) % 100).padStart(2, "0")}` : `${b.y - 1}/${String(b.y % 100).padStart(2, "0")}`);
export const bsLabel = (b: BSDate) => `${b.d} ${BS_MONTHS[b.m - 1]} ${b.y}`;
