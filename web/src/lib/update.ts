/**
 * Knowing whether this copy is the latest version, and getting it when it is not.
 *
 * Each build carries its git commit (BUILD). The published site carries version.json,
 * never cached, naming the latest version and its commit. Comparing the two says for
 * certain whether this copy is the latest.
 */
import { BUILD, VERSION } from "../version.ts";

export interface Release { version: string; released: string; build: string; code: string; notes?: string[] }

const HOME = import.meta.env.BASE_URL;
export const canUpdate = () => location.protocol === "https:" && BUILD !== "dev";

export async function latest(): Promise<Release> {
  const r = await fetch(`${HOME}version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("No version note on the site.");
  return r.json();
}

export type Check = { state: "latest" | "behind"; release: Release } | { state: "offline" } | { state: "local" };

export async function check(): Promise<Check> {
  if (!canUpdate()) return { state: "local" };
  try {
    const release = await latest();
    const same = release.build ? release.build === BUILD : release.version === VERSION;
    return { state: same ? "latest" : "behind", release };
  } catch { return { state: "offline" }; }
}

/** Fetches the new version through the offline worker, then reloads into it. */
export async function update(): Promise<void> {
  const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  const reg = sw ? await sw.getRegistration(HOME) : undefined;
  if (sw && reg) {
    const switched = new Promise<void>((res) => sw.addEventListener("controllerchange", () => res(), { once: true }));
    try { await reg.update(); } catch { /* fall through */ }
    if (reg.installing || reg.waiting) await Promise.race([switched, new Promise<void>((res) => setTimeout(res, 8000))]);
  }
  try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } catch { /* ignore */ }
  location.reload();
}

/** After an update: the notes of the version you just moved to, shown once. */
const SEEN = "ss-seen-version";
export function justUpdated(): boolean {
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN); localStorage.setItem(SEEN, VERSION); } catch { return false; }
  return !!seen && seen !== VERSION;
}
