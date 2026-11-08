// Automatic daily database backup (VACUUM INTO) with 7-day retention.
import { readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { DATA_DIR } from "../config.ts";

const DIR = join(DATA_DIR, "backups");
const KEEP = Number(process.env.BACKUP_KEEP_DAYS || 7);

export function dailyBackup(): string | null {
  const day = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const file = join(DIR, `auto-${day}.db`);
  if (existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const autos = readdirSync(DIR).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of autos.slice(0, Math.max(0, autos.length - KEEP))) unlinkSync(join(DIR, old));
  return file;
}

export function listBackups() {
  return readdirSync(DIR).filter((f) => f.endsWith(".db")).sort().reverse();
}
