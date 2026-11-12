// NEPSE closures beyond the normal weekly days off. Only dates confirmed from an official notice or a
// reliable report are listed here, with the source. Unlisted closures are still caught at run time:
// a recent "NEPSE closed" notice in the news, or no trades reported by 11:20 on a trading day.
export interface Closure { date: string; reason: string; source: string }

const range = (from: string, to: string, reason: string, source: string): Closure[] => {
  const out: Closure[] = [];
  for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) out.push({ date: new Date(t).toISOString().slice(0, 10), reason, source });
  return out;
};

export const CLOSURES: Closure[] = [
  // 22 to 26 Kartik 2083; trading resumes Friday 27 Kartik (13 Nov 2026).
  ...range("2026-11-08", "2026-11-12", "Tihar public holiday", "https://www.sharesansar.com/newsdetail/nepse-to-remain-closed-govt-declares-public-holiday-on-the-occasion-of-tihar-2026-11-08"),
];
const MAP = new Map(CLOSURES.map((c) => [c.date, c]));
export const closureOn = (date: string): Closure | undefined => MAP.get(date);

/** Matches news titles that announce a market closure. */
export const CLOSE_NOTICE = /(nepse|share market|stock market|secondary market)[^.]{0,60}\b(remain closed|to be closed|will be closed|closed)\b|\bmarket holiday\b/i;
