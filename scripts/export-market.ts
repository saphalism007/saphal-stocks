// Builds the market-data snapshot the web app downloads: a compact SQLite file
// (public market data only, never personal data), gzip-compressed, plus a manifest.
//   npm run export-data            -> web/public/data/market.db.gz + manifest.json
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, unlinkSync, rmSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, config } from "../server/config.ts";
import "../server/db.ts"; // runs migrations so the schema is current

const OUT_DIR = join(ROOT, "web", "public", "data");
mkdirSync(OUT_DIR, { recursive: true });
rmSync(join(OUT_DIR, "market.db.gz"), { force: true });
const tmp = join(ROOT, "data", "market-export.tmp.db");
if (existsSync(tmp)) unlinkSync(tmp);

// Precompute market-wide factors and setups so phones read them instead of recomputing.
{
  const { db } = await import("../server/db.ts");
  const { persistComputed } = await import("../server/lib/market.ts");
  const t0 = Date.now();
  const write = (name: string, stamp: string, json: string) => db.prepare("INSERT OR REPLACE INTO computed (name, stamp, json, created_at) VALUES (?, ?, ?, ?)").run(name, stamp, json, new Date().toISOString());
  persistComputed(write);
  const T = await import("../server/lib/trading.ts");
  const { setupKeyPublic } = await import("../server/lib/market.ts");
  const opp = T.computeOpportunities();
  write("opportunities", setupKeyPublic(), JSON.stringify(opp));
  write("track", setupKeyPublic(), JSON.stringify(T.computeTrack()));
  const INS = await import("../server/lib/insights.ts");
  write("signal_board", setupKeyPublic(), JSON.stringify(INS.computeSignalBoard()));
  // Forward log: today's BUY and SELL signals (one row per stock per day).
  const ins = db.prepare("INSERT OR REPLACE INTO signal_log (date, symbol, action, setup, entry_low, entry_high, stop, t1, t2, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const o of opp.rows.filter((r) => r.action === "BUY" || r.action === "SELL")) ins.run(o.priceDate, o.symbol, o.action, o.setupType, o.entryLow, o.entryHigh, o.stop, o.targets[0]?.price ?? null, o.targets[1]?.price ?? null, o.price);
  console.log(`precomputed factors and setups in ${Date.now() - t0} ms`);
}

const src = new DatabaseSync(config.dbPath);
src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
src.close();

const db = new DatabaseSync(tmp);
// Personal tables never leave this computer.
const PERSONAL = ["users", "sessions", "login_attempts", "portfolios", "transactions", "watchlists", "watchlist_items", "alerts", "notifications", "vault", "documents", "doc_pages", "ai_conversations", "ai_messages", "settings", "deposit_rates", "money_entries", "_migrations"];
db.exec("PRAGMA foreign_keys = OFF");
for (const t of PERSONAL) db.exec(`DROP TABLE IF EXISTS ${t}`);
// Keep the snapshot small enough for phones.
db.exec("DELETE FROM prices WHERE date < '2008-01-01'");
db.exec("DELETE FROM announcements WHERE published_date < date('now', '-3 years')");
db.exec("DELETE FROM ingest_runs WHERE id NOT IN (SELECT id FROM ingest_runs ORDER BY id DESC LIMIT 40)");
db.exec("DELETE FROM floorsheet_broker WHERE date < (SELECT MIN(date) FROM (SELECT DISTINCT date FROM floorsheet_day ORDER BY date DESC LIMIT 10))");
db.exec("UPDATE prices SET source = NULL");
db.exec("UPDATE products SET user_edited = 0");
db.exec("ANALYZE");
db.exec("VACUUM");
const asOf = (db.prepare("SELECT MAX(date) d FROM quotes").get() as { d: string | null }).d;
const counts = Object.fromEntries(["companies", "prices", "indices", "reports", "dividends", "announcements", "issues", "fund_navs", "forex"].map((t) => [t, (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n]));
const freshness = db.prepare("SELECT dataset, as_of, last_success_at FROM data_freshness").all();
db.close();

const raw = readFileSync(tmp);
const gz = gzipSync(raw, { level: 9 });
writeFileSync(join(OUT_DIR, "market.db.bin"), gz); // gzip inside; .bin so no server adds Content-Encoding
unlinkSync(tmp);
const manifest = {
  version: createHash("sha256").update(gz).digest("hex").slice(0, 16),
  generatedAt: new Date().toISOString(),
  asOf,
  rawBytes: raw.length,
  gzipBytes: gz.length,
  counts,
  freshness,
  schema: 4,
};
writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`market.db.bin ${(gz.length / 1e6).toFixed(1)} MB (raw ${(raw.length / 1e6).toFixed(1)} MB), as of ${asOf}, version ${manifest.version}`);
void statSync;
