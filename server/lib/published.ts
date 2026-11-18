// The Mac version fills in market data from the files the cloud job publishes every day (see shared/published.ts).
// It updates itself only while it is running, so without this a Mac that was off at the scheduled time showed old
// prices until its own update finished. This takes a second or two at start-up and every 10 minutes after.
import { all, get, run, tx } from "../db.ts";
import { applyQuotes, applyRecent, type LiveFile, type RecentFile } from "../../shared/published.ts";

const BASE = process.env.PUBLISHED_DATA_URL || "https://saphalism007.github.io/saphal-stocks/data/";
const DB = { run, get, tx };

async function fetchJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(`${BASE}${name}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000), headers: { "Cache-Control": "no-cache" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

/** Returns what changed, for the log. Never throws. */
export async function syncFromPublished(): Promise<string> {
  const out: string[] = [];
  try {
    const recent = await fetchJson<RecentFile>("recent.json");
    if (recent) { const n = applyRecent(DB, "", recent); if (n) out.push(`${n} new trading day(s) up to ${recent.asOf}`); }
    const live = await fetchJson<LiveFile>("live.json");
    if (live && applyQuotes(DB, "", live)) out.push(`latest prices as of ${live.asOf}`);
  } catch (e) { return `failed: ${e instanceof Error ? e.message : e}`; }
  void all;
  return out.join(", ");
}

export function startPublishedSync(onChange: () => void) {
  const tick = async () => { const msg = await syncFromPublished(); if (msg && !msg.startsWith("failed")) { console.log(`[published] ${msg}`); onChange(); } };
  void tick();
  setInterval(() => void tick(), 10 * 60_000);
}
