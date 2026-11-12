// GitHub skips or delays its own scheduled runs, so while this Mac is on it asks GitHub to refresh the
// online app (phone and browser) at the right moments on NEPSE trading days:
//   10:35 news and prices before the open, every 15 minutes from 11:00 to 15:15, and 15:50 full daily update.
// Uses the GitHub sign-in this Mac already has for git (never stored in the app or in git).
// Off when CLOUD_NUDGE=0, outside the Mac server, or when no GitHub sign-in is found.
import { execFileSync } from "node:child_process";
import { ROOT } from "../config.ts";
import { getSetting, setSetting } from "../db.ts";
import { nptNow, tradingWeekdays, marketStatus } from "../ingest/jobs.ts";
import { closureOn } from "../../shared/holidays.ts";

const REPO = "saphalism007/saphal-stocks";
const WORKFLOW = "data-and-deploy.yml";

function token(): string | null {
  try {
    const out = execFileSync("git", ["credential", "fill"], { cwd: ROOT, input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return out.match(/^password=(.+)$/m)?.[1] ?? null;
  } catch { return null; }
}

/** The slot due now, if any: "HH:MM-mode". */
export function dueSlot(minutes: number): { key: string; mode: "intraday" | "daily" } | null {
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (minutes >= 635 && minutes < 645) return { key: hm(635), mode: "intraday" };
  if (minutes >= 660 && minutes <= 915) { const s = 660 + Math.floor((minutes - 660) / 15) * 15; return minutes - s < 5 ? { key: hm(s), mode: "intraday" } : null; }
  if (minutes >= 950 && minutes < 965) return { key: hm(950), mode: "daily" };
  return null;
}

export function startCloudNudge() {
  if (process.env.CLOUD_NUDGE === "0" || process.env.CI) return;
  let tok: string | null | undefined;
  const tick = async () => {
    const n = nptNow();
    if (!tradingWeekdays().includes(n.weekday) || closureOn(n.date)) return;
    const slot = dueSlot(n.minutes); if (!slot) return;
    if (slot.mode === "intraday" && n.minutes > 680 && marketStatus().holiday) return; // no trading today
    const key = `${n.date} ${slot.key}`;
    if (getSetting<string>("lastCloudNudge", "") === key) return;
    setSetting("lastCloudNudge", key);
    if (tok === undefined) tok = token();
    if (!tok) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, Accept: "application/vnd.github+json", "User-Agent": "saphal-stocks-mac", "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { mode: slot.mode } }), signal: AbortSignal.timeout(15000),
      });
      console.log(`[cloud] asked GitHub for a ${slot.mode} update (${slot.key} NPT): ${r.status === 204 ? "ok" : r.status}`);
      if (r.status === 401 || r.status === 403) tok = null;
    } catch (e) { console.warn("[cloud] update request failed:", e instanceof Error ? e.message : e); }
  };
  setInterval(() => void tick(), 60_000);
  void tick();
}
