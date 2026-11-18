import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { applyQuotes, applyRecent, buildRecent, PRICE_COLS, INDEX_COLS } from "../shared/published.ts";

function makeDb() {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE prices (symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL, amount REAL, trades REAL, source TEXT, PRIMARY KEY (symbol, date));
    CREATE TABLE indices (index_id INTEGER NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, change REAL, change_pct REAL, turnover REAL, source TEXT, PRIMARY KEY (index_id, date));
    CREATE TABLE quotes (symbol TEXT PRIMARY KEY, date TEXT, open REAL, high REAL, low REAL, close REAL, ltp REAL, prev_close REAL, change REAL, change_pct REAL, vwap REAL, volume REAL, turnover REAL, trades REAL, high52 REAL, low52 REAL, fetched_at TEXT, source TEXT);
    CREATE TABLE data_freshness (dataset TEXT PRIMARY KEY, source TEXT, source_url TEXT, last_success_at TEXT, as_of TEXT, rows INTEGER, last_error TEXT, last_error_at TEXT);`);
  const db = {
    run: (s: string, ...a: unknown[]) => d.prepare(s).run(...(a as never[])),
    get: <T>(s: string, ...a: unknown[]) => d.prepare(s).get(...(a as never[])) as T | undefined,
    all: <T>(s: string, ...a: unknown[]) => d.prepare(s).all(...(a as never[])) as T[],
    tx: <T>(fn: () => T) => { d.exec("BEGIN"); try { const r = fn(); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; } },
  };
  return db;
}

describe("published catch-up files", () => {
  it("fills in trading days a device is missing, and raises the data date", () => {
    const cloud = makeDb(), phone = makeDb();
    for (const d of ["2026-11-13", "2026-11-17"]) {
      cloud.run("INSERT INTO prices VALUES ('NABIL', ?, 500, 510, 495, 505, 1000, 505000, 50, 'src')", d);
      cloud.run("INSERT INTO indices VALUES (12, 'NEPSE Index', ?, 2700, 2720, 2690, 2710, 10, 0.37, 1e9, 'src')", d);
    }
    phone.run("INSERT INTO prices VALUES ('NABIL', '2026-11-13', 500, 510, 495, 505, 1000, 505000, 50, 'src')");
    phone.run("INSERT INTO data_freshness (dataset, as_of, last_success_at) VALUES ('prices_history', '2026-11-13', '2026-11-13T18:00:00Z')");
    const f = buildRecent(cloud.all, "2026-11-17T19:00:00Z");
    expect(f.asOf).toBe("2026-11-17");
    expect(f.prices.columns).toEqual(PRICE_COLS); expect(f.indices.columns).toEqual(INDEX_COLS);
    expect(applyRecent(phone, "", f)).toBe(1);
    expect(phone.get<{ n: number }>("SELECT COUNT(*) n FROM prices WHERE date = '2026-11-17'")?.n).toBe(1);
    expect(phone.get<{ n: number }>("SELECT COUNT(*) n FROM indices")?.n).toBe(2);
    expect(phone.get<{ as_of: string }>("SELECT as_of FROM data_freshness WHERE dataset = 'prices_history'")?.as_of).toBe("2026-11-17");
    expect(applyRecent(phone, "", f)).toBe(0); // applying again changes nothing
  });

  it("applies newer quotes and ignores older ones", () => {
    const db = makeDb();
    const live = { generatedAt: "2026-11-17T19:00:00Z", asOf: "2026-11-17", columns: ["symbol", "close", "ltp", "volume"], quotes: [["NABIL", 505, 505, 1000]] };
    expect(applyQuotes(db, "", live)).toBe(true);
    expect(db.get<{ date: string }>("SELECT date FROM quotes WHERE symbol = 'NABIL'")?.date).toBe("2026-11-17");
    expect(applyQuotes(db, "", { ...live, asOf: "2026-11-13", generatedAt: "2026-11-13T18:00:00Z" })).toBe(false);
    expect(db.get<{ as_of: string }>("SELECT as_of FROM data_freshness WHERE dataset = 'prices_latest'")?.as_of).toBe("2026-11-17");
  });
});
