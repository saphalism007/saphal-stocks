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

/** Market session for "now", shared by the Mac server and the in-browser app so both always agree.
 *  q runs a read-only SQL query against the market data. */
export function computeMarketStatus(n: { date: string; minutes: number; weekday: number }, days: number[], q: <T>(sql: string, ...args: unknown[]) => T[], extraHoliday = false, note = "") {
  const OPEN = 660, CLOSE = 900;
  const f = q<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM data_freshness WHERE dataset = 'prices_latest'")[0];
  const weekday = days.includes(n.weekday);
  const known = closureOn(n.date);
  let notice: { title: string; url: string; date: string | null } | null = null;
  try {
    const since = new Date(Date.parse(n.date + "T00:00:00Z") - 6 * 86_400_000).toISOString().slice(0, 10);
    const hit = q<{ title: string; url: string; published_date: string | null }>("SELECT title, url, published_date FROM announcements WHERE COALESCE(published_date, substr(fetched_at, 1, 10)) >= ? ORDER BY COALESCE(published_date, fetched_at) DESC LIMIT 300", since).find((r) => CLOSE_NOTICE.test(r.title));
    if (hit) notice = { title: hit.title, url: hit.url, date: hit.published_date };
  } catch { /* older data */ }
  const noTodayData = !f || f.as_of < n.date;
  // No trades by 11:20 although prices were checked after 11:05 today (or a closure notice is out): not trading today.
  const checkedToday = !!f && Date.parse(f.last_success_at) >= Date.parse(`${n.date}T05:20:00Z`);
  const noTrades = weekday && !known && n.minutes >= OPEN + 20 && noTodayData && (checkedToday || !!notice);
  const holiday = !!known || extraHoliday || noTrades;
  const tradingDay = weekday && !holiday;
  const session = !tradingDay ? "closed" : n.minutes < OPEN ? "pre-open" : n.minutes <= CLOSE ? "open" : "closed";
  const reason = known ? known.reason : holiday ? (notice ? `closure notice: ${notice.title}` : "no trades reported today") : !weekday ? "weekly day off" : null;
  let nextOpen = tradingDay && n.minutes < OPEN ? n.date : "";
  for (let t = Date.parse(n.date + "T00:00:00Z") + 86_400_000, k = 0; !nextOpen && k < 30; t += 86_400_000, k++) { const d = new Date(t).toISOString().slice(0, 10); if (days.includes(new Date(t).getUTCDay()) && !closureOn(d)) nextOpen = d; }
  return {
    nptDate: n.date, nptTime: `${String(Math.floor(n.minutes / 60)).padStart(2, "0")}:${String(n.minutes % 60).padStart(2, "0")}`,
    tradingDay, holiday, reason, nextOpen, notice, session, hours: "11:00-15:00 NPT",
    lastUpdate: f?.last_success_at ?? null, dataDate: f?.as_of ?? null,
    live: session === "open" && !!f && f.as_of === n.date,
    note: note || "During market hours prices refresh about every 15 minutes (delayed, not tick-by-tick). Official closing data is loaded after 15:45.",
  };
}
