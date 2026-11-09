// Browser replacement for server/ingest/jobs.ts. Data collection runs in the GitHub Actions
// pipeline (or the desktop server); the web app downloads the published snapshot.
import { all, get } from "./b-db.ts";

const notHere = () => { throw Object.assign(new Error("Data refresh runs automatically in the cloud pipeline; the app downloads new data when it is published. Use Settings → Data → Check for new data."), { status: 400 }); };
export const syncListing = notHere, syncHistory = notHere, syncIndices = notHere, syncCompanyDetail = notHere, syncAllDetails = notHere,
  syncNews = notHere, syncForex = notHere, syncIssues = notHere, syncFunds = notHere;
export const enqueue = () => ({ status: "done" });
export const jobStates = () => [];
export const queueDailyRefresh = () => {};
export const onJobDone = () => {};
export const startScheduler = () => {};
export const startIntradayPoller = () => {};
export const saveAnnouncements = () => {};
export const freshnessReport = () => all("SELECT * FROM data_freshness ORDER BY dataset");

export function nptNow() {
  const d = new Date(Date.now() + (5 * 60 + 45) * 60_000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay() };
}
export function tradingWeekdays(): number[] {
  const last = get<{ d: string }>("SELECT MAX(date) d FROM indices WHERE index_id = 12")?.d;
  const rows = all<{ date: string }>("SELECT date FROM indices WHERE index_id = 12 AND date >= date(?, '-60 days')", last ?? "2000-01-01");
  const c: Record<number, number> = {};
  for (const r of rows) { const w = new Date(r.date + "T00:00:00Z").getUTCDay(); c[w] = (c[w] ?? 0) + 1; }
  const days = Object.entries(c).filter(([, n]) => n >= 3).map(([w]) => Number(w));
  return days.length ? days : [1, 2, 3, 4, 5];
}
export function marketStatus() {
  const n = nptNow();
  const tradingDay = tradingWeekdays().includes(n.weekday);
  const session = !tradingDay ? "closed" : n.minutes < 660 ? "pre-open" : n.minutes <= 900 ? "open" : "closed";
  const f = get<{ last_success_at: string; as_of: string }>("SELECT last_success_at, as_of FROM data_freshness WHERE dataset = 'prices_latest'");
  return {
    nptDate: n.date, nptTime: `${String(Math.floor(n.minutes / 60)).padStart(2, "0")}:${String(n.minutes % 60).padStart(2, "0")}`,
    tradingDay, holiday: false, session, hours: "11:00-15:00 NPT",
    lastUpdate: f?.last_success_at ?? null, dataDate: f?.as_of ?? null, live: session === "open" && f?.as_of === n.date,
    note: "During market hours prices update about every 15 minutes from the cloud pipeline (delayed). Official closing data is published after 15:45.",
  };
}
