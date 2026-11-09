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

const src = new DatabaseSync(config.dbPath);
src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
src.close();

const db = new DatabaseSync(tmp);
// Personal tables never leave this computer.
const PERSONAL = ["users", "sessions", "login_attempts", "portfolios", "transactions", "watchlists", "watchlist_items", "alerts", "notifications", "vault", "documents", "doc_pages", "ai_conversations", "ai_messages", "settings", "_migrations"];
db.exec("PRAGMA foreign_keys = OFF");
for (const t of PERSONAL) db.exec(`DROP TABLE IF EXISTS ${t}`);
// Keep the snapshot small enough for phones.
db.exec("DELETE FROM prices WHERE date < '2008-01-01'");
db.exec("DELETE FROM announcements WHERE published_date < date('now', '-3 years')");
db.exec("DELETE FROM ingest_runs WHERE id NOT IN (SELECT id FROM ingest_runs ORDER BY id DESC LIMIT 40)");
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
