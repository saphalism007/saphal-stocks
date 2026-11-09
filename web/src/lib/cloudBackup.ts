// Backup of all personal data to iCloud Drive or Google Drive.
// iPhone/iPad: the share sheet opens with the backup file -> "Save to Files" -> iCloud Drive or
// Google Drive (or the Google Drive app). Mac/other: the file is downloaded to save there.
// The file is the same one Settings -> Backup produces (your AI key is never included).
import { api } from "./api.ts";
import { flushBackend } from "./backend.ts";

const LAST = "ss-last-backup";
export function lastBackup(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
export function backupDue(days = 7): boolean { const l = lastBackup(); return !l || Date.now() - Date.parse(l) > days * 86_400_000; }

async function backupFile(): Promise<File> {
  flushBackend();
  const r = await api<{ filename: string; base64: string }>("/backup/file");
  const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
  const day = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  return new File([bytes], `saphal-stocks-backup-${day}.db`, { type: "application/octet-stream" });
}

/** Returns how the backup was handed over: "shared" (share sheet), "downloaded", or "cancelled". */
export async function backupToCloud(): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = await backupFile();
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: "Saphal Stocks backup", text: "Save to Files → iCloud Drive or Google Drive" });
      try { localStorage.setItem(LAST, new Date().toISOString()); } catch { /* ignore */ }
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // Fall through to a download if sharing failed for another reason.
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  try { localStorage.setItem(LAST, new Date().toISOString()); } catch { /* ignore */ }
  return "downloaded";
}

export async function restoreFromFile(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 15)) !== "SQLite format 3") throw new Error("This is not a Saphal Stocks backup file.");
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  await api("/backup/restore", { body: { base64: btoa(s) } });
}
