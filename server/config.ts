// Loads .env (creating it with a fresh encryption key on first run) and exposes typed config.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "data");
mkdirSync(join(DATA_DIR, "cache"), { recursive: true });
mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
mkdirSync(join(DATA_DIR, "backups"), { recursive: true });

const envPath = join(ROOT, ".env");
if (!existsSync(envPath)) {
  const example = existsSync(join(ROOT, ".env.example")) ? readFileSync(join(ROOT, ".env.example"), "utf8") : "";
  writeFileSync(envPath, example.replace(/^SAPHAL_SECRET_KEY=.*$/m, `SAPHAL_SECRET_KEY=${randomBytes(32).toString("hex")}`), { mode: 0o600 });
}
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!/^[0-9a-f]{64}$/i.test(process.env.SAPHAL_SECRET_KEY || "")) {
  const key = randomBytes(32).toString("hex");
  const txt = readFileSync(envPath, "utf8");
  writeFileSync(envPath, /^SAPHAL_SECRET_KEY=/m.test(txt) ? txt.replace(/^SAPHAL_SECRET_KEY=.*$/m, `SAPHAL_SECRET_KEY=${key}`) : txt + `\nSAPHAL_SECRET_KEY=${key}\n`, { mode: 0o600 });
  process.env.SAPHAL_SECRET_KEY = key;
}

export const config = {
  port: Number(process.env.API_PORT || 5181),
  host: process.env.HOST || "127.0.0.1", // 0.0.0.0 = reachable on your local network (use only on trusted Wi-Fi)
  secretKey: Buffer.from(process.env.SAPHAL_SECRET_KEY as string, "hex"),
  dbPath: join(DATA_DIR, "saphal-stocks.db"),
  isProd: process.env.NODE_ENV === "production",
  ai: {
    get provider() { return (process.env.AI_PROVIDER || "anthropic").toLowerCase(); },
    get model() { return process.env.AI_MODEL || "claude-opus-5-5"; },
    get effort() { return (process.env.AI_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max"; },
    get apiKey() { return process.env.ANTHROPIC_API_KEY || ""; },
    get hasKey() { return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN); },
  },
  ingestDailyAt: process.env.INGEST_DAILY_AT || "15:45",
  userAgent: "SaphalStocks/0.1 (personal research tool; low-rate)",
};

/** Persist a single key into .env (used by Settings for AI configuration). Never logs values. */
export function setEnvValue(key: string, value: string) {
  if (!/^[A-Z0-9_]+$/.test(key)) throw new Error("Invalid key");
  const clean = value.replace(/[\r\n]/g, "");
  const txt = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(envPath, re.test(txt) ? txt.replace(re, `${key}=${clean}`) : txt + `\n${key}=${clean}\n`, { mode: 0o600 });
  process.env[key] = clean;
}
