// "Back up to iCloud / Google Drive" card, used on My Money and Settings.
import { useState } from "react";
import { Card, Notice } from "./ui.tsx";
import { I } from "./icons.tsx";
import { backupToCloud, restoreFromFile, lastBackup } from "../lib/cloudBackup.ts";
import { nptDate, ago } from "../lib/format.ts";

export function CloudBackup({ compact = false }: { compact?: boolean }) {
  const [msg, setMsg] = useState<{ t: string; warn?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastBackup());
  const back = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await backupToCloud();
      setLast(lastBackup());
      setMsg(r === "shared" ? { t: "Done. If you chose Save to Files, pick iCloud Drive or Google Drive as the location." } : r === "downloaded" ? { t: "Backup file saved. Move it to your iCloud Drive or Google Drive folder." } : { t: "Backup cancelled.", warn: true });
    } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); } finally { setBusy(false); }
  };
  const restore = async (f: File) => {
    if (!confirm("Replace all personal data on this device with this backup? (Market data is not affected.)")) return;
    try { await restoreFromFile(f); setMsg({ t: "Backup restored. Reloading..." }); setTimeout(() => location.reload(), 800); } catch (e) { setMsg({ t: e instanceof Error ? e.message : String(e), warn: true }); }
  };
  return (
    <Card title="Back up to iCloud or Google Drive" sub={last ? `Last backup ${nptDate(last, true)} (${ago(last)})` : "No backup yet on this device"}>
      {!compact && <p className="small muted">One file with everything personal: income & expenses, My Money, portfolios, journal, goals, watchlists, alerts and settings. Your AI key is never included.</p>}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={back}>{busy ? <span className="spinner" /> : <><I.upload /> Back up now</>}</button>
        <label className="btn"><I.download /> Restore from a backup<input type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); e.target.value = ""; }} /></label>
      </div>
      {!compact && <ol className="tiny muted" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
        <li>iPhone / iPad: tap <strong>Back up now</strong> <strong>Save to Files</strong> &gt; choose <strong>iCloud Drive</strong> or <strong>Google Drive</strong> &gt; Save.</li>
        <li>Mac: the file goes to Downloads; drag it into iCloud Drive or Google Drive.</li>
        <li>To restore on any device: <strong>Restore from a backup</strong> &gt; pick the file from iCloud Drive or Google Drive.</li>
      </ol>}
      {msg && <div style={{ marginTop: 8 }}><Notice tone={msg.warn ? "warn" : "info"}>{msg.t}</Notice></div>}
    </Card>
  );
}
