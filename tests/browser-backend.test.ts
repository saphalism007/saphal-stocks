// Runs the in-browser backend (route code + sql.js + attached market snapshot) inside Node.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import initSqlJs, { type Database } from "sql.js";
import { useDatabase, USER_SCHEMA, mergeReferenceData, ensureStarterData } from "../web/src/backend/b-db.ts";
import { Router, makeResponse, type Request } from "../web/src/backend/b-express.ts";
import { requireAuth } from "../web/src/backend/b-auth.ts";
import { marketRouter } from "../server/routes/market.ts";
import { portfolioRouter } from "../server/routes/portfolio.ts";
import { wealthRouter } from "../server/routes/wealth.ts";

const SNAP = "web/public/data/market.db.bin";
const has = existsSync(SNAP);
let main: Database;
const app = Router();
app.use("/api", requireAuth, marketRouter, portfolioRouter, wealthRouter);

async function call(method: string, path: string, body?: unknown) {
  const url = new URL(path, "http://x");
  const res = makeResponse(() => {}, () => {});
  const req: Request = { method, path: url.pathname, url: path, params: {}, query: Object.fromEntries(url.searchParams), body: body ?? {}, headers: {}, cookies: {}, ip: "t", secure: true, get: () => undefined };
  try { await app.handle(req, res, url.pathname); } catch (e) { return { status: (e as { status?: number }).status ?? 500, json: { error: String((e as Error).message) } }; }
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

describe.skipIf(!has)("browser backend (sql.js + routes)", () => {
  beforeAll(async () => {
    const SQL = await initSqlJs();
    const market = new SQL.Database(gunzipSync(readFileSync(SNAP)));
    main = new SQL.Database();
    main.exec(USER_SCHEMA);
    main.exec(`ATTACH DATABASE '${(market as unknown as { filename: string }).filename}' AS m`);
    useDatabase(main);
    mergeReferenceData();
    ensureStarterData();
  });

  it("serves market data from the attached snapshot", async () => {
    const r = await call("GET", "/api/market/summary");
    expect(r.status).toBe(200);
    expect(r.json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.json.counts.traded).toBeGreaterThan(100);
    const s = await call("GET", "/api/stocks/NABIL");
    expect(s.status).toBe(200);
    expect(s.json.technical.close).toBeGreaterThan(0);
    expect(s.json.levels.supports.length).toBeGreaterThan(0);
  });

  it("writes personal data to the device database, not the snapshot", async () => {
    const ports = await call("GET", "/api/portfolios");
    const id = ports.json[0].id;
    const t = await call("POST", `/api/portfolios/${id}/transactions`, { symbol: "NABIL", type: "buy", date: "2025-03-10", quantity: 10, price: 500 });
    expect(t.status).toBe(200);
    const p = await call("GET", `/api/portfolios/${id}`);
    expect(p.json.summary.holdings[0].quantity).toBe(10);
    const inMain = main.exec("SELECT COUNT(*) FROM main.transactions")[0].values[0][0];
    expect(inMain).toBe(1);
  });

  it("validates input like the server", async () => {
    const r = await call("POST", "/api/portfolios/1/transactions", { symbol: "??", type: "buy", date: "x", quantity: -1, price: 1 });
    expect(r.status).toBe(500); // ZodError surfaces; the worker maps it to 400 with a message
  });

  it("keeps product edits in the device copy across snapshot refreshes", async () => {
    const list = await call("GET", "/api/products");
    const fd = list.json.find((p: { seed_key: string }) => p.seed_key === "fd");
    await call("PUT", `/api/products/${fd.id}`, { return_text: "Recorded 7.5%", verified_on: "2026-11-09" });
    mergeReferenceData();
    const again = await call("GET", "/api/products");
    expect(again.json.find((p: { seed_key: string }) => p.seed_key === "fd").return_text).toBe("Recorded 7.5%");
  });
});
