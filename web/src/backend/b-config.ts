// Browser replacement for server/config.ts. AI settings live in this device's settings table.
import { getSetting, setSetting } from "./b-db.ts";

export const ROOT = "/";
export const DATA_DIR = "/data";
export const config = {
  port: 0,
  host: "browser",
  secretKey: new Uint8Array(32),
  dbPath: "browser",
  isProd: true,
  ai: {
    get provider() { return getSetting<string>("aiProvider", "anthropic"); },
    get model() { return getSetting<string>("aiModel", "claude-opus-5-5"); },
    get effort() { return getSetting<"low" | "medium" | "high" | "xhigh" | "max">("aiEffort", "medium"); },
    get apiKey() { return getSetting<string>("aiKey", ""); },
    get hasKey() { return !!getSetting<string>("aiKey", ""); },
  },
  ingestDailyAt: "15:45",
  userAgent: "SaphalStocks/web",
};

export function setEnvValue(key: string, value: string) {
  const map: Record<string, string> = { AI_PROVIDER: "aiProvider", AI_MODEL: "aiModel", AI_EFFORT: "aiEffort", ANTHROPIC_API_KEY: "aiKey" };
  if (map[key]) setSetting(map[key], value);
}
