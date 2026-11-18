import { describe, expect, it } from "vitest";
import { computeMarketStatus } from "../shared/holidays.ts";

const q = (asOf: string, checked: string, titles: string[] = []) => (<T,>(sql: string) => (sql.includes("data_freshness") ? [{ as_of: asOf, last_success_at: checked }] : titles.map((title) => ({ title, url: "u" + title, published_date: "2026-11-08" }))) as T[]);
const MF = [1, 2, 3, 4, 5];

describe("market status", () => {
  it("warns when this device is missing the last trading day, skipping the Chhath holiday", () => {
    // 2 Mangsir (18 Nov), morning: the last trading day was 1 Mangsir (17 Nov); 16 Nov was a holiday.
    const stale = computeMarketStatus({ date: "2026-11-18", minutes: 10 * 60, weekday: 3 }, MF, q("2026-11-13", "2026-11-13T18:00:00Z"));
    expect(stale.lastSession).toBe("2026-11-17"); expect(stale.behind).toBe("2026-11-17");
    const ok = computeMarketStatus({ date: "2026-11-18", minutes: 10 * 60, weekday: 3 }, MF, q("2026-11-17", "2026-11-17T19:00:00Z"));
    expect(ok.behind).toBeNull();
    // On 17 Nov the last trading day before it was 13 Nov (Tihar, weekend and the Chhath holiday in between).
    const tue = computeMarketStatus({ date: "2026-11-17", minutes: 10 * 60, weekday: 2 }, MF, q("2026-11-13", "2026-11-13T18:00:00Z"));
    expect(tue.lastSession).toBe("2026-11-13"); expect(tue.behind).toBeNull();
  });
  it("is closed on the Tihar holiday with the next session on Friday 13 Nov", () => {
    const s = computeMarketStatus({ date: "2026-11-12", minutes: 12 * 60 + 20, weekday: 4 }, MF, q("2026-11-06", "2026-11-11T17:55:00Z"));
    expect(s.session).toBe("closed"); expect(s.holiday).toBe(true); expect(s.reason).toMatch(/Tihar/); expect(s.nextOpen).toBe("2026-11-13");
  });
  it("is open on a normal trading day with today's prices", () => {
    const s = computeMarketStatus({ date: "2026-11-13", minutes: 12 * 60, weekday: 5 }, MF, q("2026-11-13", "2026-11-13T06:00:00Z"));
    expect(s.session).toBe("open"); expect(s.live).toBe(true);
  });
  it("says closed when no trades are reported by 11:20 after a fresh check", () => {
    const s = computeMarketStatus({ date: "2026-11-17", minutes: 11 * 60 + 30, weekday: 2 }, MF, q("2026-11-16", "2026-11-17T05:35:00Z"));
    expect(s.session).toBe("closed"); expect(s.reason).toBe("no trades reported today");
  });
  it("uses a closure notice in the news once 11:20 passes without trades", () => {
    const s = computeMarketStatus({ date: "2026-11-17", minutes: 11 * 60 + 25, weekday: 2 }, MF, q("2026-11-16", "2026-11-16T10:00:00Z", ["NEPSE to Remain Closed on Tuesday"]));
    expect(s.session).toBe("closed"); expect(s.notice?.title).toMatch(/Remain Closed/);
  });
  it("stays pre-open before 11:00 on a trading day", () => {
    const s = computeMarketStatus({ date: "2026-11-13", minutes: 10 * 60 + 40, weekday: 5 }, MF, q("2026-11-06", "2026-11-12T10:00:00Z"));
    expect(s.session).toBe("pre-open"); expect(s.nextOpen).toBe("2026-11-13");
  });
});
