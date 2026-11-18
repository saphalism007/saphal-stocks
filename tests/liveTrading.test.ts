import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseLiveTrading } from "../shared/liveTrading.ts";
import { applyQuotes, applyLiveIndices } from "../shared/published.ts";

const html = readFileSync(new URL("./fixtures/live-trading.html", import.meta.url), "utf8");

describe("ShareSansar live-trading page", () => {
  it("reads the time, prices and indices exactly as shown", () => {
    const p = parseLiveTrading(html, "2026-11-18T08:09:00.000Z");
    expect(p.asOf).toBe("2026-11-18"); expect(p.time).toBe("13:54:00"); expect(p.marketOpen).toBe(true);
    expect(p.quotes.quotes.length).toBe(30);
    const ix = (c: string) => p.quotes.columns.indexOf(c);
    const adbl = p.quotes.quotes.find((r) => r[0] === "ADBL")!;
    expect([adbl[ix("ltp")], adbl[ix("change")], adbl[ix("change_pct")], adbl[ix("open")], adbl[ix("high")], adbl[ix("low")], adbl[ix("volume")], adbl[ix("prev_close")]]).toEqual([331, -0.9, -0.27, 331.9, 332.9, 328.1, 13702, 331.9]);
    const nepse = p.indices.find((x) => x.name === "NEPSE Index")!;
    expect(nepse).toMatchObject({ id: 12, value: 2621.53, changePct: -0.55 });
  });
  it("refuses a page whose layout changed instead of guessing", () => {
    expect(() => parseLiveTrading("<html>nothing</html>", "x")).toThrow();
  });
  it("applies to an attached market database without touching official rows or 52-week values", () => {
    const d = new DatabaseSync(":memory:"); d.exec("ATTACH ':memory:' AS m");
    d.exec(`CREATE TABLE m.prices (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, amount REAL, trades REAL, source TEXT, PRIMARY KEY (symbol, date));
      CREATE TABLE m.indices (index_id INTEGER, name TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, change REAL, change_pct REAL, turnover REAL, source TEXT, PRIMARY KEY (index_id, date));
      CREATE TABLE m.quotes (symbol TEXT PRIMARY KEY, date TEXT, open REAL, high REAL, low REAL, close REAL, ltp REAL, prev_close REAL, change REAL, change_pct REAL, vwap REAL, volume REAL, turnover REAL, trades REAL, high52 REAL, low52 REAL, fetched_at TEXT, source TEXT);
      CREATE TABLE m.data_freshness (dataset TEXT PRIMARY KEY, source TEXT, source_url TEXT, last_success_at TEXT, as_of TEXT, rows INTEGER, last_error TEXT, last_error_at TEXT);
      INSERT INTO m.quotes (symbol, date, close, high52, low52) VALUES ('ADBL', '2026-11-17', 331.9, 360, 285.2);
      INSERT INTO m.indices VALUES (12, 'NEPSE Index', '2026-11-17', 2630, 2640, 2620, 2636.03, 0, 0, 1, 'src');
      INSERT INTO m.data_freshness (dataset, as_of, last_success_at) VALUES ('prices_latest', '2026-11-17', '2026-11-17T19:00:00Z');`);
    const db = { run: (s: string, ...a: unknown[]) => d.prepare(s).run(...(a as never[])), get: <T,>(s: string, ...a: unknown[]) => d.prepare(s).get(...(a as never[])) as T, tx: <T,>(f: () => T) => f() };
    const p = parseLiveTrading(html, "2026-11-18T08:09:00.000Z");
    expect(applyQuotes(db, "m.", p.quotes)).toBe(true);
    expect(d.prepare("SELECT date, ltp, high52, low52 FROM m.quotes WHERE symbol = 'ADBL'").get()).toMatchObject({ date: "2026-11-18", ltp: 331, high52: 360, low52: 285.2 });
    expect(d.prepare("SELECT close, source FROM m.prices WHERE symbol = 'ADBL' AND date = '2026-11-18'").get()).toMatchObject({ close: 331, source: "live" });
    expect(applyLiveIndices(db, "m.", p.asOf, p.indices)).toBeGreaterThan(0);
    expect(d.prepare("SELECT close, change FROM m.indices WHERE index_id = 12 AND date = '2026-11-18'").get()).toMatchObject({ close: 2621.53, change: -14.5 });
    // The official close (not 'live') is never replaced by a later live reading.
    d.exec("UPDATE m.prices SET close = 330, source = 'ShareSansar' WHERE symbol = 'ADBL' AND date = '2026-11-18'");
    applyQuotes(db, "m.", { ...p.quotes, generatedAt: "2026-11-18T09:00:00.000Z" });
    expect(d.prepare("SELECT close FROM m.prices WHERE symbol = 'ADBL' AND date = '2026-11-18'").get()).toMatchObject({ close: 330 });
  });
});
